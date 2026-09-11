import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

export type DatabaseRole = "web" | "jobs";
export type PostgresPoolRole = DatabaseRole | "migrations";

export type SqlQuery = {
  text: string;
  values?: readonly unknown[];
  name?: string;
};

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(query: SqlQuery): Promise<QueryResult<Row>>;
}

export type DatabaseMetrics = {
  queries: number;
  queryErrors: number;
  queryDurationMs: number;
  transactions: number;
  transactionRollbacks: number;
};

type PoolState = {
  web?: Pool;
  jobs?: Pool;
  migrations?: Pool;
  metrics?: Record<DatabaseRole, DatabaseMetrics>;
};

const state = globalThis as typeof globalThis & { novelReaderPostgres?: PoolState };

function readInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function databaseUrl(role: PostgresPoolRole): string {
  const migrationUrl = process.env.PG_MIGRATION_DATABASE_URL?.trim();
  const value = role === "migrations" && migrationUrl
    ? migrationUrl
    : process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(role === "migrations"
      ? "PG_MIGRATION_DATABASE_URL or DATABASE_URL is required for PostgreSQL migrations"
      : "DATABASE_URL is required for the PostgreSQL runtime");
  }
  return value;
}

function poolState(): PoolState {
  state.novelReaderPostgres ||= {};
  state.novelReaderPostgres.metrics ||= {
    web: { queries: 0, queryErrors: 0, queryDurationMs: 0, transactions: 0, transactionRollbacks: 0 },
    jobs: { queries: 0, queryErrors: 0, queryDurationMs: 0, transactions: 0, transactionRollbacks: 0 },
  };
  return state.novelReaderPostgres;
}

function roleStatementTimeoutMs(role: PostgresPoolRole): number {
  const isWeb = role === "web";
  const isMigration = role === "migrations";
  return readInteger(
    isWeb ? "PG_WEB_STATEMENT_TIMEOUT_MS" : isMigration ? "PG_MIGRATION_STATEMENT_TIMEOUT_MS" : "PG_JOB_STATEMENT_TIMEOUT_MS",
    isWeb ? 3_000 : isMigration ? 300_000 : 30_000,
    250,
    900_000,
  );
}

/**
 * node-postgres aborts a query on a client-side timer as well as the server's
 * statement_timeout, and that timer is not raised by a per-statement `SET`. A statement
 * that deliberately outlives the pool's default timeout must still finish inside this,
 * or it fails as a client error instead of a cancellable statement timeout.
 */
export function postgresQueryTimeoutMs(role: PostgresPoolRole = "web"): number {
  return roleStatementTimeoutMs(role) + 1_000;
}

function createPool(role: PostgresPoolRole): Pool {
  const isMigration = role === "migrations";
  const isWeb = role === "web";
  const statementTimeout = roleStatementTimeoutMs(role);
  const config: PoolConfig = {
    connectionString: databaseUrl(role),
    application_name: `novel-reader-${role}`,
    max: isMigration ? 1 : readInteger(isWeb ? "PG_WEB_POOL_SIZE" : "PG_JOB_POOL_SIZE", isWeb ? 16 : 4, 1, 32),
    connectionTimeoutMillis: readInteger("PG_CONNECTION_TIMEOUT_MS", 5_000, 100, 30_000),
    idleTimeoutMillis: readInteger("PG_IDLE_TIMEOUT_MS", 30_000, 1_000, 300_000),
    statement_timeout: statementTimeout,
    query_timeout: statementTimeout + 1_000,
    options: "-c timezone=UTC -c idle_in_transaction_session_timeout=10000",
  };
  const pool = new Pool(config);
  pool.on("error", (error) => {
    console.error(JSON.stringify({
      event: "postgres.pool.idle-client.failed",
      role,
      message: error.message,
    }));
  });
  return pool;
}

export function getPostgresPool(role: PostgresPoolRole = "web"): Pool {
  const current = poolState();
  current[role] ||= createPool(role);
  return current[role]!;
}

function observe<Row extends QueryResultRow>(
  role: DatabaseRole,
  operation: () => Promise<QueryResult<Row>>,
): Promise<QueryResult<Row>> {
  const metrics = poolState().metrics![role];
  const startedAt = performance.now();
  metrics.queries += 1;
  return operation()
    .catch((error: unknown) => {
      metrics.queryErrors += 1;
      throw error;
    })
    .finally(() => {
      metrics.queryDurationMs += performance.now() - startedAt;
    });
}

const executors = new Map<DatabaseRole, SqlExecutor>();

/** Executors are stable per role so per-executor caches can key on identity. */
export function database(role: DatabaseRole = "web"): SqlExecutor {
  const existing = executors.get(role);
  if (existing) return existing;
  const executor: SqlExecutor = {
    query: <Row extends QueryResultRow>(query: SqlQuery) => observe(
      role,
      () => getPostgresPool(role).query<Row>({
        text: query.text,
        values: query.values ? [...query.values] : undefined,
        name: query.name,
      }),
    ),
  };
  executors.set(role, executor);
  return executor;
}

export type TransactionOptions = {
  role?: DatabaseRole;
  isolation?: "read committed" | "repeatable read" | "serializable";
  readOnly?: boolean;
  lockTimeoutMs?: number;
};

const ISOLATION_LEVELS = {
  "read committed": "READ COMMITTED",
  "repeatable read": "REPEATABLE READ",
  serializable: "SERIALIZABLE",
} as const;

function normalizedTransactionOptions(options: TransactionOptions): {
  role: DatabaseRole;
  isolation: (typeof ISOLATION_LEVELS)[keyof typeof ISOLATION_LEVELS];
  readOnly: boolean;
  lockTimeoutMs: number;
} {
  const role = options.role ?? "web";
  if (role !== "web" && role !== "jobs") throw new Error("Invalid PostgreSQL transaction role");
  const isolationKey = options.isolation ?? "read committed";
  const isolation = ISOLATION_LEVELS[isolationKey];
  if (!isolation) throw new Error("Invalid PostgreSQL transaction isolation level");
  if (options.readOnly !== undefined && typeof options.readOnly !== "boolean") {
    throw new Error("Invalid PostgreSQL read-only transaction option");
  }
  const candidate = options.lockTimeoutMs ?? 500;
  if (!Number.isFinite(candidate)) throw new Error("Invalid PostgreSQL transaction lock timeout");
  return {
    role,
    isolation,
    readOnly: options.readOnly === true,
    lockTimeoutMs: Math.min(Math.max(Math.floor(candidate), 1), 30_000),
  };
}

function transactionExecutor(client: PoolClient, role: DatabaseRole): SqlExecutor {
  return {
    query: <Row extends QueryResultRow>(query: SqlQuery) => observe(
      role,
      () => client.query<Row>({
        text: query.text,
        values: query.values ? [...query.values] : undefined,
        name: query.name,
      }),
    ),
  };
}

export async function withTransaction<T>(
  operation: (transaction: SqlExecutor) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const normalized = normalizedTransactionOptions(options);
  const { role } = normalized;
  const metrics = poolState().metrics![role];
  const client = await getPostgresPool(role).connect();
  metrics.transactions += 1;
  let releaseError: Error | undefined;
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${normalized.isolation}${normalized.readOnly ? " READ ONLY" : ""}`);
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${normalized.lockTimeoutMs}ms`]);
    const result = await operation(transactionExecutor(client, role));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    metrics.transactionRollbacks += 1;
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      console.error(JSON.stringify({
        event: "postgres.transaction.rollback.failed",
        role,
        message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      }));
    }
    throw error;
  } finally {
    // A session whose rollback failed can still be inside a transaction. Passing
    // the error makes pg destroy it instead of leaking session state to a user.
    client.release(releaseError);
  }
}

export function getDatabaseMetrics(): Record<DatabaseRole, DatabaseMetrics> {
  const metrics = poolState().metrics!;
  return {
    web: { ...metrics.web },
    jobs: { ...metrics.jobs },
  };
}

export async function closePostgresPools(): Promise<void> {
  const current = poolState();
  const pools = [current.web, current.jobs, current.migrations].filter((pool): pool is Pool => Boolean(pool));
  current.web = undefined;
  current.jobs = undefined;
  current.migrations = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
}
