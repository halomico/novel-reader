import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { createOrResumeOriginalDraft, OriginalDraftError } from "@/features/original-editor/server";
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
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let input: { clientKey?: unknown; articleSlug?: unknown };
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  try {
    const draft = createOrResumeOriginalDraft({
      authorId: user.id,
      clientKey: String(input.clientKey || ""),
      articleSlug: input.articleSlug ? String(input.articleSlug) : undefined,
    });
    return NextResponse.json({ draftId: draft.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
