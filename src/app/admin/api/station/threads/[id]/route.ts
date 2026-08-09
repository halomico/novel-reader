import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getStationThread, listStationMessages, markStationThreadRead } from "@/lib/station";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed || !await getAdminSession()) {
    return privateJson({ ok: false, message: "无权访问" }, 401);
  }
  const { id } = await context.params;
  const threadId = Math.floor(Number(id));
  const thread = getStationThread(threadId, { admin: true });
  if (!thread) return privateJson({ ok: false, message: "对话不存在" }, 404);
  markStationThreadRead(thread.id, "admin");
  return privateJson({
    ok: true,
    status: thread.status,
    messages: listStationMessages(thread.id),
  });
}
