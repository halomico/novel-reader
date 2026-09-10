import { database, type SqlExecutor } from "@/core/db/postgres";

const BATCH_SIZE = 500;
const INTERVAL_MS = 60_000;

const RETENTION_TARGETS = [
  { table: "analytics_events", timestamp: "created_at", statement: "analytics-retention-events-v1" },
  { table: "search_query_events", timestamp: "created_at", statement: "analytics-retention-search-v1" },
  { table: "admin_login_records", timestamp: "logged_at", statement: "analytics-retention-admin-v1" },
] as const;

export function postgresAnalyticsRetentionDays(value = process.env.ANALYTICS_RETENTION_DAYS): number {
  const days = Number(value || 180);
  return Number.isFinite(days) ? Math.min(Math.max(Math.floor(days), 7), 3_650) : 180;
}

/**
 * Deletes a small, lock-friendly batch from every append-only analytics table.
 * SKIP LOCKED lets multiple maintenance replicas cooperate without blocking
 * request writes or deleting the same rows twice.
 */
export async function prunePostgresAnalyticsRetention(
  executor: SqlExecutor,
  days = postgresAnalyticsRetentionDays(),
  batchSize = BATCH_SIZE,
): Promise<number> {
  if (!Number.isInteger(days) || days < 7 || days > 3_650) throw new Error("Invalid analytics retention days");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5_000) throw new Error("Invalid analytics retention batch size");

  const deleted = await Promise.all(RETENTION_TARGETS.map(async (target) => {
    const result = await executor.query({
      name: target.statement,
      text: `WITH expired AS (
               SELECT id
               FROM ${target.table}
               WHERE ${target.timestamp} < clock_timestamp() - make_interval(days => $1)
               ORDER BY ${target.timestamp} ASC, id ASC
               LIMIT $2
               FOR UPDATE SKIP LOCKED
             )
             DELETE FROM ${target.table} AS target
             USING expired
             WHERE target.id = expired.id`,
      values: [days, batchSize],
    });
    return result.rowCount ?? 0;
  }));
  return deleted.reduce((total, count) => total + count, 0);
}

export function initializePostgresAnalyticsMaintenance(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const state = globalThis as typeof globalThis & {
    postgresAnalyticsMaintenanceTimer?: ReturnType<typeof setInterval>;
  };
  if (state.postgresAnalyticsMaintenanceTimer) return;
  state.postgresAnalyticsMaintenanceTimer = setInterval(() => {
    void prunePostgresAnalyticsRetention(database("jobs")).catch((error: unknown) => {
      console.error(JSON.stringify({
        event: "postgres.analytics.retention.failed",
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }, INTERVAL_MS);
  state.postgresAnalyticsMaintenanceTimer.unref?.();
}
