import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";

export type PostgresAdminLoginRecord = {
  username: string;
  ip: string;
  userAgent: string;
  loggedAt: string;
};

export type PostgresAdminLoginRecordPage = {
  records: PostgresAdminLoginRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function safeInteger(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL admin ${name}`);
  return parsed;
}

function isoTimestamp(value: Date | string, name: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL admin ${name}`);
  return date.toISOString();
}

function bounded(value: number, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), minimum), maximum) : fallback;
}

export async function recordPostgresAdminLogin(
  executor: SqlExecutor,
  usernameValue: string,
  ipValue: string,
  userAgentValue: string,
): Promise<void> {
  const username = usernameValue.trim().slice(0, 128);
  const ip = ipValue.trim().slice(0, 128);
  const userAgent = userAgentValue.trim().slice(0, 240);
  if (!username || !ip || !username.isWellFormed() || !ip.isWellFormed() || !userAgent.isWellFormed()) {
    throw new Error("Invalid admin login audit input");
  }
  await executor.query({
    text: "INSERT INTO admin_login_records (username, ip, user_agent) VALUES ($1, $2, $3)",
    values: [username, ip, userAgent],
  });
}

export async function listPostgresAdminLoginRecordPage(
  executor: SqlExecutor,
  pageValue: number,
  pageSizeValue = 15,
): Promise<PostgresAdminLoginRecordPage> {
  const pageSize = bounded(pageSizeValue, 15, 1, 100);
  const requestedPage = bounded(pageValue, 1, 1, 1_000_000);
  const countResult = await executor.query<QueryResultRow & { total: string | number }>({
    name: "identity-admin-login-count-v1",
    text: "SELECT count(*)::bigint AS total FROM admin_login_records",
  });
  const total = safeInteger(countResult.rows[0]?.total ?? 0, "login count");
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(requestedPage, totalPages);
  const result = await executor.query<QueryResultRow & {
    username: string; ip: string; user_agent: string; logged_at: Date | string;
  }>({
    text: `SELECT username, ip, user_agent, logged_at FROM admin_login_records
      ORDER BY logged_at DESC, id DESC LIMIT $1 OFFSET $2`,
    values: [pageSize, (page - 1) * pageSize],
  });
  return {
    records: result.rows.map((row) => ({
      username: row.username,
      ip: row.ip,
      userAgent: row.user_agent,
      loggedAt: isoTimestamp(row.logged_at, "login timestamp"),
    })),
    page,
    pageSize,
    total,
    totalPages,
  };
}

export async function getPostgresAdminCatalogStats(executor: SqlExecutor): Promise<{
  totalBooks: number;
  totalSizeBytes: number;
}> {
  const result = await executor.query<QueryResultRow & { total_books: string | number; total_size_bytes: string | number }>({
    name: "identity-admin-catalog-stats-v1",
    text: `SELECT count(*)::bigint AS total_books,
      coalesce(sum(size_bytes), 0)::bigint AS total_size_bytes FROM novels`,
  });
  return {
    totalBooks: safeInteger(result.rows[0]?.total_books ?? 0, "novel count"),
    totalSizeBytes: safeInteger(result.rows[0]?.total_size_bytes ?? 0, "novel bytes"),
  };
}
