import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    ok: false,
    message: "PostgreSQL 使用在线分代发布；清空索引操作已停用，请使用原子完整重建。",
  }, {
    status: 410,
    headers: { "Cache-Control": "private, no-store" },
  });
}
