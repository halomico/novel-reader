import { NextResponse } from "next/server";
import { elapsedMilliseconds, formatServerTiming } from "@/core/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const startedAt = performance.now();
  return NextResponse.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": formatServerTiming([{ name: "total", durationMs: elapsedMilliseconds(startedAt) }]),
    },
  });
}
