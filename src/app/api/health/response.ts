import { type SqlExecutor } from "@/core/db/postgres";
import { elapsedMilliseconds, formatServerTiming } from "@/core/observability/runtime";

export async function createHealthResponse(executor: SqlExecutor): Promise<Response> {
  const totalStartedAt = performance.now();
  const databaseStartedAt = performance.now();
  try {
    await executor.query({ text: "SELECT 1" });
    const databaseDuration = elapsedMilliseconds(databaseStartedAt);
    return Response.json(
      { ok: true },
      { headers: {
        "Cache-Control": "no-store",
        "Server-Timing": formatServerTiming([
          { name: "db", durationMs: databaseDuration },
          { name: "total", durationMs: elapsedMilliseconds(totalStartedAt) },
        ]),
      } },
    );
  } catch {
    const databaseDuration = elapsedMilliseconds(databaseStartedAt);
    return Response.json(
      { ok: false },
      { status: 503, headers: {
        "Cache-Control": "no-store",
        "Server-Timing": formatServerTiming([
          { name: "db", durationMs: databaseDuration },
          { name: "total", durationMs: elapsedMilliseconds(totalStartedAt) },
        ]),
      } },
    );
  }
}
