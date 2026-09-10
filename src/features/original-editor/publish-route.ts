import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import type { PostgresUserProfile } from "@/domains/identity/postgres-users";
import { OriginalDraftError, publishOriginalDraft } from "./server";

type PublishRouteDependencies = {
  currentUser(request: NextRequest): Promise<PostgresUserProfile | null>;
  publish(input: Parameters<typeof publishOriginalDraft>[0]): ReturnType<typeof publishOriginalDraft>;
};

export function createOriginalDraftPublishHandler(dependencies: PublishRouteDependencies) {
  return async function handlePublish(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const guard = validateSameOriginMutation(request);
    if (guard) return guard;
    const user = await dependencies.currentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const parsed = await readJsonBody<{ revision?: unknown; mutationId?: unknown }>(request, 16 * 1024);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.reason === "too_large" ? "请求内容过大" : "请求格式无效" },
        { status: parsed.reason === "too_large" ? 413 : 400 },
      );
    }
    const body = parsed.value;
    const draftId = Number((await params).id);
    try {
      const result = await dependencies.publish({
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
  };
}
