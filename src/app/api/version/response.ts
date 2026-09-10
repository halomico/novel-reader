import { NextResponse } from "next/server";
import { getBuildInfo } from "@/lib/build-info";
import { type PostgresSchemaStatus } from "@/core/db/postgres-migrations";
import { elapsedMilliseconds, formatServerTiming } from "@/core/observability/runtime";

export async function createVersionResponse(
  getSchemaStatus: () => Promise<PostgresSchemaStatus>,
): Promise<NextResponse> {
  const startedAt = performance.now();
  let body: ReturnType<typeof getBuildInfo> | { ok: false };
  let status = 200;
  try {
    body = getBuildInfo(await getSchemaStatus());
  } catch {
    body = { ok: false };
    status = 503;
  }
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": formatServerTiming([{ name: "total", durationMs: elapsedMilliseconds(startedAt) }]),
    },
  });
}
