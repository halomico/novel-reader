import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { OriginalDraftError, publishOriginalDraft } from "@/features/original-editor/server";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let body: { revision?: unknown; mutationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  const draftId = Number((await params).id);
  try {
    const result = publishOriginalDraft({
      draftId,
      author: user,
      expectedRevision: Number(body.revision),
      mutationId: String(body.mutationId || ""),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OriginalDraftError) {
      const status = error.code === "conflict"
        ? 409
        : error.code === "not_found"
          ? 404
          : error.code === "forbidden"
            ? 403
            : 400;
      return NextResponse.json({ error: error.message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Failed to publish original draft", error);
    return NextResponse.json({ error: "发布失败，请稍后重试" }, { status: 500 });
  }
}
