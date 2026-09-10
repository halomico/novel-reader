import { NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { getPostgresStationThread, listPostgresStationMessages, markPostgresStationThreadRead } from "@/domains/station/postgres-station";
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
  const requestUrl = new URL(_request.url);
  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);
  const { id } = await context.params;
  const threadId = Math.floor(Number(id));
  const thread = await getPostgresStationThread(database("web"), threadId, { userId: user.id });
  if (!thread) return privateJson({ ok: false, message: "对话不存在" }, 404);
  const requestedAfter = Number(requestUrl.searchParams.get("afterId") || requestUrl.searchParams.get("after") || 0);
  const afterId = Number.isSafeInteger(requestedAfter) && requestedAfter > 0 ? requestedAfter : 0;
  const messages = await listPostgresStationMessages(database("web"), thread.id, afterId > 0 ? { afterId } : {});
  // Only advance the read marker after the response payload was assembled.
  // A failed/aborted request therefore cannot silently consume unread work.
  await markPostgresStationThreadRead(database("web"), thread.id, "user", user.id);
  return privateJson({
    ok: true,
    status: thread.status,
    messages,
  });
}
