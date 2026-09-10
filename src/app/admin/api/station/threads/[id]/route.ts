import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getPostgresStationThread, listPostgresStationMessages, markPostgresStationThreadRead } from "@/domains/station/postgres-station";

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
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed || !await getAdminSession()) {
    return privateJson({ ok: false, message: "无权访问" }, 401);
  }
  const { id } = await context.params;
  const threadId = Math.floor(Number(id));
  const thread = await getPostgresStationThread(database("web"), threadId, { admin: true });
  if (!thread) return privateJson({ ok: false, message: "对话不存在" }, 404);
  const requestedAfter = Number(requestUrl.searchParams.get("afterId") || requestUrl.searchParams.get("after") || 0);
  const afterId = Number.isSafeInteger(requestedAfter) && requestedAfter > 0 ? requestedAfter : 0;
  const messages = await listPostgresStationMessages(database("web"), thread.id, afterId > 0 ? { afterId } : {});
  await markPostgresStationThreadRead(database("web"), thread.id, "admin");
  return privateJson({
    ok: true,
    status: thread.status,
    messages,
  });
}
