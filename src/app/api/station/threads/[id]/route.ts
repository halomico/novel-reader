import { NextResponse } from "next/server";
import { getStationThread, listStationMessages, markStationThreadRead } from "@/lib/station";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);
  const { id } = await context.params;
  const threadId = Math.floor(Number(id));
  const thread = getStationThread(threadId, { userId: user.id });
  if (!thread) return privateJson({ ok: false, message: "对话不存在" }, 404);
  markStationThreadRead(thread.id, "user", user.id);
  return privateJson({
    ok: true,
    status: thread.status,
    messages: listStationMessages(thread.id),
  });
}
