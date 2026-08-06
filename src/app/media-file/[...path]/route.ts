import { NextRequest } from "next/server";
import { authorizeMediaDelivery, resolveMediaDeliveryUri, serveMediaDelivery } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { isMediaKindPublic } from "@/lib/media";
import { hasValidVideoDownloadSession } from "@/lib/media-access";
import { playbackViewerFromRequest } from "@/lib/playback-viewer";
import { validateVideoPlaybackLease } from "@/lib/video-playback";
import { videoPlaybackUsesHlsOnly } from "@/lib/video-playback-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deliver(request: NextRequest) {
  const delivery = resolveMediaDeliveryUri(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (!delivery) {
    return new Response(null, { status: 404 });
  }
  const user = getCurrentUserFromRequest(request);
  const access = checkContentAccess(request.headers, {
    scope: delivery.asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (
    !access.allowed ||
    !authorizeMediaDelivery(delivery, Boolean(user)) ||
    (delivery.download && delivery.asset.kind === "video" && (
      !user || (user.role !== "admin" && !hasValidVideoDownloadSession({
        userId: user.id,
        mediaId: delivery.asset.id,
        token: delivery.downloadToken,
      }))
    ))
  ) {
    return new Response(null, { status: 404 });
  }
  if (delivery.asset.kind === "video" && !delivery.download) {
    if (videoPlaybackUsesHlsOnly()) {
      return new Response(null, { status: 404 });
    }
    const viewer = playbackViewerFromRequest(request, user?.id || null);
    if (
      !viewer ||
      !delivery.playbackSessionId ||
      !delivery.playbackToken ||
      !validateVideoPlaybackLease({
        id: delivery.playbackSessionId,
        token: delivery.playbackToken,
        viewerKey: viewer.viewerKey,
        mediaId: delivery.asset.id,
      })
    ) {
      return new Response(null, { status: 404 });
    }
  }
  return serveMediaDelivery(request, delivery, {
    publiclyAccessible: !delivery.download &&
      isMediaKindPublic(delivery.asset.kind) &&
      !hasScopedContentAccessRules(delivery.asset.kind),
  });
}

export const GET = deliver;
export const HEAD = deliver;
