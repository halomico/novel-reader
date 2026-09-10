import { type NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { isPostgresMediaFavorite } from "@/domains/activity/postgres-favorites";
import { getPostgresMediaGroveState } from "@/domains/activity/postgres-grove";
import { getPostgresMediaRecommendationState } from "@/domains/activity/postgres-recommendations";
import { hasPostgresUserPermission } from "@/domains/identity/postgres-permissions";
import { getPostgresMediaSummary } from "@/domains/media/postgres-media-engagement";
import { canConsumeHomePortal } from "@/lib/home-portal";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  const mediaId = Number((await params).id);
  const [asset, settings] = await Promise.all([getPostgresMediaSummary(database("web"), mediaId), readPostgresSiteSettings()]);
  if (!asset || asset.kind === "file" || !canConsumeHomePortal(settings.homePortalAccessModes[asset.kind], true)) {
    return NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
  }

  const canRecommend = await hasPostgresUserPermission(database("web"), user, "novel_feedback");
  return NextResponse.json(
    {
      ok: true,
      favorite: await isPostgresMediaFavorite(database("web"), user.id, mediaId),
      inGrove: (await getPostgresMediaGroveState(database("web"), user.id, mediaId)).planted,
      recommended: canRecommend ? (await getPostgresMediaRecommendationState(database("web"), user.id, mediaId)).recommended : false,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
