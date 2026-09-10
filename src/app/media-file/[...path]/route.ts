import { NextRequest } from "next/server";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess, hasPostgresScopedContentAccessRules } from "@/domains/access/postgres-content-access";
import { hasValidPostgresVideoDownloadSession } from "@/domains/media/postgres-media-access";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import { validatePostgresVideoPlaybackLease } from "@/domains/media/postgres-video-playback";
import { authorizeMediaDelivery, resolveMediaDeliveryUri, serveMediaDelivery } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { isMediaKindPublic } from "@/domains/media/media-model";
import { playbackViewerFromRequest } from "@/lib/playback-viewer";
import { videoPlaybackUsesHlsOnly } from "@/lib/video-playback-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deliver(request: NextRequest) {
  const delivery = await resolveMediaDeliveryUri(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    (id) => getPostgresMediaAsset(database("web"), id),
  );
  if (!delivery) {
    return new Response(null, { status: 404 });
  }
  const user = await getCurrentUserFromRequest(request);
  const downloadSessionValid = delivery.download && delivery.asset.kind === "video" && user?.role !== "admin"
    ? await hasValidPostgresVideoDownloadSession(database("web"), {
        userId: user?.id ?? 0,
        mediaId: delivery.asset.id,
        token: delivery.downloadToken,
      }).catch(() => false)
    : true;
  const access = await checkPostgresContentAccess(database("web"), request.headers, {
    scope: delivery.asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (
    !access.allowed ||
    !authorizeMediaDelivery(delivery, Boolean(user)) ||
    (delivery.download && delivery.asset.kind === "video" && (
      !user || !downloadSessionValid
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
      !await validatePostgresVideoPlaybackLease(database("web"), {
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
      !await hasPostgresScopedContentAccessRules(database("web"), delivery.asset.kind),
  });
}

export const GET = deliver;
export const HEAD = deliver;
