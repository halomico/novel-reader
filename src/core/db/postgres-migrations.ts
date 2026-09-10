import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { getPostgresPool } from "./postgres";

// Migration names historically use both kebab-case and snake_case. Treat both
// as first-class names so a valid numbered migration can never be skipped just
// because its descriptive suffix contains an underscore.
const MIGRATION_PATTERN = /^(\d{4,10})_([a-z0-9_-]+)\.sql$/u;
const MIGRATION_LOCK_KEY = "novel-reader-schema-v1";
export const POSTGRES_BIGM_VERSION = "1.2";
export const POSTGRES_SERVER_MAJOR = 18;

export type PostgresMigration = {
  version: number;
  name: string;
  fileName: string;
  checksum: string;
  sql: string;
};

export type PostgresSchemaStatus = {
  currentVersion: number;
  expectedVersion: number;
  pendingVersions: number[];
  extensionVersion: string | null;
  serverVersionNum: number;
  readOnly: boolean;
  inRecovery: boolean;
};

export type PostgresCompatibilityIssue = {
  code: "server-version" | "read-only" | "recovery" | "schema-version" | "pending-migrations" | "extension-version";
  message: string;
};

export type PostgresSchemaCompatibility = {
  compatible: boolean;
  issues: PostgresCompatibilityIssue[];
};

export function postgresStartupCompatibility(
  status: PostgresSchemaStatus,
  environment: string | undefined,
): PostgresSchemaCompatibility {
  const compatibility = assessPostgresSchemaCompatibility(status);
  if (environment === "production") return compatibility;
  const issues = compatibility.issues.filter((issue) => issue.code !== "extension-version");
  return { compatible: issues.length === 0, issues };
}

type PostgresRuntimeStatus = Pick<PostgresSchemaStatus, "serverVersionNum" | "readOnly" | "inRecovery">;

function runtimeCompatibilityIssues(status: PostgresRuntimeStatus): PostgresCompatibilityIssue[] {
  const issues: PostgresCompatibilityIssue[] = [];
  const serverMajor = Math.floor(status.serverVersionNum / 10_000);
  if (serverMajor !== POSTGRES_SERVER_MAJOR) {
    issues.push({
      code: "server-version",
      message: `PostgreSQL ${POSTGRES_SERVER_MAJOR} is required; server_version_num is ${status.serverVersionNum}`,
    });
  }
  if (status.readOnly) {
    issues.push({ code: "read-only", message: "PostgreSQL is configured read-only" });
  }
  if (status.inRecovery) {
    issues.push({ code: "recovery", message: "PostgreSQL is in recovery" });
  }
  return issues;
}

export function assessPostgresSchemaCompatibility(status: PostgresSchemaStatus): PostgresSchemaCompatibility {
  const issues = runtimeCompatibilityIssues(status);
  if (status.currentVersion !== status.expectedVersion) {
    issues.push({
      code: "schema-version",
      message: `PostgreSQL schema ${status.currentVersion} does not match expected ${status.expectedVersion}`,
    });
  }
  if (status.pendingVersions.length) {
    issues.push({
      code: "pending-migrations",
      message: `Pending PostgreSQL migrations: ${status.pendingVersions.join(", ")}`,
    });
  }
  if (status.extensionVersion !== POSTGRES_BIGM_VERSION) {
    issues.push({
      code: "extension-version",
      message: `pg_bigm ${POSTGRES_BIGM_VERSION} is required; found ${status.extensionVersion || "not installed"}`,
    });
  }
  return { compatible: issues.length === 0, issues };
}

function runtimeStatusFromRow(row: PostgresRuntimeStatus | undefined): PostgresRuntimeStatus {
  if (!row) throw new Error("PostgreSQL runtime status query returned no rows");
  return row;
}

async function readRuntimeStatus(client: Pick<PoolClient, "query">): Promise<PostgresRuntimeStatus> {
  const result = await client.query<PostgresRuntimeStatus>(`
    SELECT
      current_setting('server_version_num')::integer AS "serverVersionNum",
      current_setting('transaction_read_only') = 'on' AS "readOnly",
      pg_is_in_recovery() AS "inRecovery"
  `);
  return runtimeStatusFromRow(result.rows[0]);
}

function assertWritableMigrationRuntime(status: PostgresRuntimeStatus): void {
  const issues = runtimeCompatibilityIssues(status);
  if (!issues.length) return;
  throw new Error(`PostgreSQL migration preflight failed: ${issues.map((issue) => issue.message).join("; ")}`);
}

function migrationDirectory(): string {
  return path.resolve(process.env.POSTGRES_MIGRATIONS_DIR || path.join(process.cwd(), "migrations", "postgres"));
}

function checksum(sql: string): string {
  return crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export async function readPostgresMigrations(): Promise<PostgresMigration[]> {
  const directory = migrationDirectory();
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const migrations = await Promise.all(entries
    .filter((entry) => entry.isFile() && MIGRATION_PATTERN.test(entry.name))
    .map(async (entry) => {
      const match = entry.name.match(MIGRATION_PATTERN)!;
      const sql = await fs.readFile(path.join(directory, entry.name), "utf8");
      return {
        version: Number(match[1]),
        name: match[2],
        fileName: entry.name,
        checksum: checksum(sql),
        sql,
      };
    }));
  migrations.sort((left, right) => left.version - right.version);
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version < 1) {
      throw new Error(`Invalid PostgreSQL migration version in ${migration.fileName}`);
    }
    if (seen.has(migration.version)) throw new Error(`Duplicate PostgreSQL migration version ${migration.version}`);
    seen.add(migration.version);
  }
  if (!migrations.length) throw new Error(`No PostgreSQL migrations found in ${directory}`);
  return migrations;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL CHECK (length(checksum) = 64),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

type SearchExtension = "pg_bigm" | "pg_trgm";

async function resolveSearchExtension(client: Pick<PoolClient, "query">): Promise<SearchExtension> {
  const result = await client.query<{ bigm: boolean; trgm: boolean }>(`
    SELECT
      EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm' AND default_version = '1.2') AS bigm,
      EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') AS trgm
  `);
  const row = result.rows[0];
  if (row?.bigm) return "pg_bigm";
  if (process.env.NODE_ENV === "production") {
    throw new Error("PostgreSQL production migrations require pg_bigm 1.2; install the pinned extension before migrating");
  }
  if (row?.trgm) return "pg_trgm";
  throw new Error("PostgreSQL development migrations require pg_trgm when pg_bigm 1.2 is unavailable");
}

export function adaptPostgresMigrationSql(sql: string, extension: SearchExtension): string {
  if (extension === "pg_bigm") return sql;
  return sql.replaceAll("pg_bigm", "pg_trgm").replaceAll("gin_bigm_ops", "gin_trgm_ops");
}

export async function migratePostgres(): Promise<PostgresSchemaStatus> {
  const migrations = await readPostgresMigrations();
  const client = await getPostgresPool("migrations").connect();
  let lockAcquired = false;
  let operationError: unknown;
  try {
    assertWritableMigrationRuntime(await readRuntimeStatus(client));
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [MIGRATION_LOCK_KEY]);
    lockAcquired = true;
    const searchExtension = await resolveSearchExtension(client);
    await ensureMigrationTable(client);
    const applied = await client.query<{ version: number; name: string; checksum: string }>(
      "SELECT version, name, checksum FROM app_schema_migrations ORDER BY version",
    );
    const filesByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    for (const row of applied.rows) {
      const file = filesByVersion.get(row.version);
      if (!file) throw new Error(`Applied PostgreSQL migration ${row.version} has no matching file`);
      if (file.name !== row.name) throw new Error(`PostgreSQL migration ${row.version} name changed`);
      if (file.checksum !== row.checksum) throw new Error(`PostgreSQL migration ${row.version} checksum changed`);
    }
    const appliedVersions = new Set(applied.rows.map((row) => row.version));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(adaptPostgresMigrationSql(migration.sql, searchExtension));
        await client.query(
          `INSERT INTO app_schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`PostgreSQL migration ${migration.fileName} failed`, { cause: error });
      }
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let unlockError: unknown;
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [MIGRATION_LOCK_KEY]);
      }
    } catch (error) {
      unlockError = error;
    }
    client.release(unlockError instanceof Error ? unlockError : undefined);
    if (!operationError && unlockError) {
      throw new Error("PostgreSQL migration lock could not be released", { cause: unlockError });
    }
  }
  return getPostgresSchemaStatus();
}

export async function getPostgresSchemaStatus(): Promise<PostgresSchemaStatus> {
  const migrations = await readPostgresMigrations();
  const expectedVersion = migrations.at(-1)!.version;
  const pool = getPostgresPool("web");
  const [table, runtimeStatus, extension] = await Promise.all([
    pool.query<{ present: boolean }>(
      "SELECT to_regclass('public.app_schema_migrations') IS NOT NULL AS present",
    ),
    readRuntimeStatus(pool),
    pool.query<{ version: string }>("SELECT extversion AS version FROM pg_extension WHERE extname = 'pg_bigm'"),
  ]);
  if (!table.rows[0]?.present) {
    return {
      currentVersion: 0,
      expectedVersion,
      pendingVersions: migrations.map((item) => item.version),
      extensionVersion: extension.rows[0]?.version || null,
      ...runtimeStatus,
    };
  }
  const applied = await pool.query<{ version: number; checksum: string; name: string }>(
    "SELECT version, name, checksum FROM app_schema_migrations ORDER BY version",
  );
  const filesByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied.rows) {
    const file = filesByVersion.get(row.version);
    if (!file) throw new Error(`Applied PostgreSQL migration ${row.version} has no matching file`);
    if (file.name !== row.name || file.checksum !== row.checksum) {
      throw new Error(`PostgreSQL migration ${row.version} does not match its file`);
    }
  }
  const appliedVersions = new Set(applied.rows.map((row) => row.version));
  const currentVersion = applied.rows.at(-1)?.version || 0;
  return {
    currentVersion,
    expectedVersion,
    pendingVersions: migrations.filter((item) => !appliedVersions.has(item.version)).map((item) => item.version),
    extensionVersion: extension.rows[0]?.version || null,
    ...runtimeStatus,
  };
}
