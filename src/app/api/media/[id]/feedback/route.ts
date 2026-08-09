import { type NextRequest, NextResponse } from "next/server";
import { isMediaFavorite } from "@/lib/favorites";
import { getMediaAsset, isFeedbackMediaKind, isMediaKindConsumable } from "@/lib/media";
import { getMediaRecommendationState } from "@/lib/recommendations";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  const mediaId = Number((await params).id);
  const asset = getMediaAsset(mediaId);
  if (!asset || !isFeedbackMediaKind(asset.kind) || !isMediaKindConsumable(asset.kind, true)) {
    return NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
  }

  const canRecommend = hasUserPermission(user, "novel_feedback");
  return NextResponse.json(
    {
      ok: true,
      favorite: isMediaFavorite(user.id, mediaId),
      recommended: canRecommend ? getMediaRecommendationState(user.id, mediaId).recommended : false,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
