import { NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { getCurrentUser } from "@/lib/user-auth";
import { markAllPostgresUserMessagesRead, markPostgresStationThreadRead } from "@/domains/station/postgres-station";

function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;

  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);

  const parsed = await readJsonBody<{ threadId?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) {
    return privateJson({ ok: false, message: parsed.reason === "too_large" ? "请求内容过大" : "请求内容无效" }, parsed.reason === "too_large" ? 413 : 400);
  }
  const payload = parsed.value;

  const threadId = payload.threadId == null ? null : Number(payload.threadId);
  if (threadId !== null && (!Number.isInteger(threadId) || threadId < 1)) {
    return privateJson({ ok: false, message: "对话无效" }, 400);
  }

  await markAllPostgresUserMessagesRead(user.id);
  if (threadId !== null) await markPostgresStationThreadRead(database("web"), threadId, "user", user.id);
  return privateJson({ ok: true });
}
