import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { canConsumeOriginalChannel } from "@/lib/config";
import { toggleOriginalFavorite } from "@/lib/favorites";
import { getOriginalArticleById } from "@/lib/original";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard; params }: { params: Promise<{ id: string }> }) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  const articleId = Number((await params).id);
  if (!canConsumeOriginalChannel(true) || !getOriginalArticleById(articleId)) {
    return NextResponse.json({ ok: false, message: "文章不存在" }, { status: 404 });
  }
  const result = toggleOriginalFavorite(user.id, articleId);
  return result.ok
    ? NextResponse.json({ ok: true, favorite: result.favorite })
    : NextResponse.json({ ok: false, message: "文章不存在" }, { status: 404 });
}
