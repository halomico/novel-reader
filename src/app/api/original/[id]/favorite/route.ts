import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { togglePostgresOriginalFavorite } from "@/domains/activity/postgres-favorites";
import { canConsumeOriginalChannel } from "@/lib/config";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  const articleId = Number((await params).id);
  if (!canConsumeOriginalChannel(true)) {
    return NextResponse.json({ ok: false, message: "文章不存在" }, { status: 404 });
  }
  const result = await togglePostgresOriginalFavorite(user.id, articleId);
  return result.ok
    ? NextResponse.json({ ok: true, favorite: result.favorite })
    : NextResponse.json({ ok: false, message: "文章不存在" }, { status: 404 });
}
