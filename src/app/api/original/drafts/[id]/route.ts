import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import {
  getOriginalDraftForAuthor,
  OriginalDraftError,
  saveOriginalDraft,
  deleteOriginalDraftForAuthor,
} from "@/features/original-editor/server";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function draftIdFrom(value: string): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const draft = await getOriginalDraftForAuthor(draftIdFrom((await params).id), user.id);
  return draft
    ? NextResponse.json({ draft }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "草稿不存在" }, { status: 404 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = await readJsonBody<{
    revision?: unknown;
    title?: unknown;
    editorStateJson?: unknown;
    tagIds?: unknown;
    unlockSodaPrice?: unknown;
  }>(request, 4 * 1024 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.reason === "too_large" ? "请求内容过大" : "请求格式无效" },
      { status: parsed.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = parsed.value;
  try {
    const result = await saveOriginalDraft({
      draftId: draftIdFrom((await params).id),
      authorId: user.id,
      revision: Number(body.revision),
      title: String(body.title || ""),
      editorStateJson: String(body.editorStateJson || ""),
      tagIds: Array.isArray(body.tagIds) ? body.tagIds.map(Number) : [],
      unlockSodaPrice: Number(body.unlockSodaPrice),
    });
    if (!result.ok) {
      return NextResponse.json({ error: "草稿版本冲突", conflict: true, draft: result.draft }, {
        status: 409,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ draft: result.draft }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OriginalDraftError) {
      const status = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Failed to save original draft", error);
    return NextResponse.json({ error: "草稿保存失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = validateSameOriginMutation(request, { requireJson: false });
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const removed = await deleteOriginalDraftForAuthor(draftIdFrom((await params).id), user.id);
  return NextResponse.json(removed ? { ok: true } : { error: "草稿不存在或已发布，请刷新列表" }, {
    status: removed ? 200 : 404, headers: { "Cache-Control": "no-store" },
  });
}
