import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { createOriginalEditorTag, listOriginalEditorTags, OriginalDraftError, searchOriginalEditorTags } from "@/features/original-editor/server";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 40) || "";
  try {
    const tags = query ? await searchOriginalEditorTags(query, 8) : await listOriginalEditorTags({ limit: 80 });
    return NextResponse.json({ tags }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to search original editor tags", error);
    return NextResponse.json({ error: "标签搜索失败，请稍后重试" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = await readJsonBody<{ name?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason === "too_large" ? "请求内容过大" : "请求格式无效" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  }
  const body = parsed.value;
  try {
    const tag = await createOriginalEditorTag({ name: body.name, authorId: user.id });
    return NextResponse.json({ tag }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OriginalDraftError) {
      const status = error.code === "forbidden" ? 403 : error.code === "unavailable" ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Failed to create original editor tag", error);
    return NextResponse.json({ error: "标签创建失败，请稍后重试" }, { status: 500 });
  }
}
