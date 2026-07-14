import { NextRequest } from "next/server";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getMediaAsset, isMediaKindAccessible } from "@/lib/media";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { recordMediaHistory } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  recordAnalyticsEvent({
    headers: request.headers,
    userId: user?.id ?? null,
    eventType: `${asset.kind}_view`,
    path: `/media/${asset.id}`,
    referrer: request.headers.get("referer"),
    mediaId: asset.id,
  });
  if (user) recordMediaHistory(user.id, asset);
  return new Response(null, { status: 204 });
}
