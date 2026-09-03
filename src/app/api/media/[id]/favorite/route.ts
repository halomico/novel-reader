import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { toggleMediaFavorite } from "@/lib/favorites";
import { getMediaAsset, isFeedbackMediaKind, isMediaKindConsumable } from "@/lib/media";
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
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  const mediaId = Number((await params).id);
  const asset = getMediaAsset(mediaId);
  if (!asset || !isFeedbackMediaKind(asset.kind) || !isMediaKindConsumable(asset.kind, true)) {
    return NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
  }
  const result = toggleMediaFavorite(user.id, mediaId);
  return result.ok
    ? NextResponse.json({ ok: true, favorite: result.favorite })
    : NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
}
