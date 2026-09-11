import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import {
  createOrResumeOriginalDraft,
  deleteOriginalDraftsForAuthor,
  OriginalDraftError,
} from "@/features/original-editor/server";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof OriginalDraftError) {
    const status = error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("Failed to create original draft", error);
  return NextResponse.json({ error: "草稿创建失败，请稍后重试" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = await readJsonBody<{ clientKey?: unknown; articleSlug?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.reason === "too_large" ? "请求内容过大" : "请求格式无效" },
      { status: parsed.reason === "too_large" ? 413 : 400 },
    );
  }
  const input = parsed.value;
  try {
    const draft = await createOrResumeOriginalDraft({
      authorId: user.id,
      clientKey: String(input.clientKey || ""),
      articleSlug: input.articleSlug ? String(input.articleSlug) : undefined,
    });
    return NextResponse.json({ draftId: draft.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = await readJsonBody<{ ids?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.reason === "too_large" ? "请求内容过大" : "请求格式无效" },
      { status: parsed.reason === "too_large" ? 413 : 400 },
    );
  }
  if (!Array.isArray(parsed.value.ids) || parsed.value.ids.length < 1 || parsed.value.ids.length > 100) {
    return NextResponse.json({ error: "请选择 1 至 100 篇草稿" }, { status: 400 });
  }
  try {
    const removed = await deleteOriginalDraftsForAuthor(parsed.value.ids.map(Number), user.id);
    return NextResponse.json({ ok: true, removed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
