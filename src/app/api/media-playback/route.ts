import { NextRequest, NextResponse } from "next/server";
import { getVideoPlaybackAccess } from "@/lib/media-access";
import { getMediaAsset, hasPublishedMediaHls, isMediaKindConsumable } from "@/lib/media";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { getMediaNodePlaybackCapacity } from "@/lib/media-storage-config";
import { getVideoPlaybackMode } from "@/lib/video-playback-mode";
import { attachPlaybackViewerCookie, playbackViewerFromRequest } from "@/lib/playback-viewer";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import {
  createVideoPlaybackLease,
  estimateVideoBitrateKbps,
  getVideoConcurrencyLimit,
  refreshVideoPlaybackLease,
  releaseVideoPlaybackLease,
} from "@/lib/video-playback";
import { buildAuthorizedPlaybackHlsManifest } from "@/lib/video-hls-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function body(request: NextRequest): Promise<{
  mediaId: number;
  clientId: string;
  sessionId: string;
  token: string;
}> {
  try {
    const value = await request.json() as Record<string, unknown>;
    return {
      mediaId: Number(value.mediaId),
      clientId: String(value.clientId || ""),
      sessionId: String(value.sessionId || ""),
      token: String(value.token || ""),
    };
  } catch {
    return { mediaId: 0, clientId: "", sessionId: "", token: "" };
  }
}

/**
 * Mint a playback ticket.
 * HLS responses include the fully rewritten playlist (`manifest`) so the client
 * can start without a second manifest round-trip. Segment URLs for free videos
 * are time-bucketed public signatures (CDN-friendly); paid stay private.
 */
export async function POST(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  const input = await body(request);
  const asset = getMediaAsset(input.mediaId);
  if (!asset || asset.kind !== "video" || !isMediaKindConsumable("video", Boolean(user))) {
    return NextResponse.json({ ok: false, message: "视频不存在" }, { status: 404 });
  }
  const access = getVideoPlaybackAccess(asset, user);
  if (!access.allowed) {
    return NextResponse.json(
      { ok: false, message: access.reason === "login_required" ? "请先登录" : "请先解锁视频" },
      { status: access.reason === "login_required" ? 401 : 402 },
    );
  }
  const viewer = playbackViewerFromRequest(request, user?.id || null, true)!;
  const capacity = getMediaNodePlaybackCapacity(asset.storageNodeId, asset.kind);
  const result = createVideoPlaybackLease({
    viewerKey: viewer.viewerKey,
    userId: user?.id || null,
    clientId: input.clientId,
    mediaId: asset.id,
    limit: getVideoConcurrencyLimit(user),
    storageNodeId: capacity.storageNodeId,
    reservedKbps: estimateVideoBitrateKbps(asset),
    nodeMaxStreams: capacity.maxVideoStreams,
    nodeBandwidthKbps: capacity.bandwidthKbps,
  });
  if (!result.ok) {
    const message = result.reason === "limit_reached"
      ? `同时播放的视频已达到上限（${result.limit}）`
      : result.reason === "not_allowed"
        ? "当前等级暂不能播放视频"
        : result.reason === "node_busy"
          ? "当前播放人数较多，请稍后重试"
          : "视频不存在";
    return NextResponse.json(
      { ok: false, message },
      {
        status: result.reason === "limit_reached" ? 409 : result.reason === "node_busy" ? 503 : 403,
        headers: result.reason === "node_busy" ? { "Retry-After": "15" } : undefined,
      },
    );
  }

  let mediaUrl = "";
  let manifest: string | null = null;
  let format: "mp4" | "hls" = "mp4";
  let segmentsPubliclyCacheable = false;

  try {
    const playbackMode = getVideoPlaybackMode();
    const hlsReady = hasPublishedMediaHls(asset);
    if (playbackMode !== "mp4" && hlsReady) {
      const built = await buildAuthorizedPlaybackHlsManifest(asset, {
        sessionId: result.lease.id,
        token: result.lease.token,
      });
      manifest = built.manifest;
      segmentsPubliclyCacheable = built.segmentsPubliclyCacheable;
      // Fallback URL for clients that cannot feed a Blob playlist (rare Safari cases).
      const query = new URLSearchParams({
        v: asset.playbackVersion,
        ps: result.lease.id,
        pt: result.lease.token,
      });
      mediaUrl = `/media/${asset.id}/hls/manifest?${query.toString()}`;
      format = "hls";
    } else if (playbackMode === "hls-only") {
      releaseVideoPlaybackLease({
        id: result.lease.id,
        token: result.lease.token,
        viewerKey: viewer.viewerKey,
        mediaId: asset.id,
      });
      const unavailable = NextResponse.json(
        { ok: false, message: "视频正在迁移为 HLS，暂时无法播放" },
        { status: 503, headers: { "Retry-After": "60" } },
      );
      attachPlaybackViewerCookie(unavailable, viewer);
      return unavailable;
    } else {
      mediaUrl = mediaDeliveryUrl(asset, false, {
        publiclyAccessible: false,
        estimatedKbps: estimateVideoBitrateKbps(asset),
        playbackSessionId: result.lease.id,
        playbackToken: result.lease.token,
      });
    }
  } catch {
    releaseVideoPlaybackLease({
      id: result.lease.id,
      token: result.lease.token,
      viewerKey: viewer.viewerKey,
      mediaId: asset.id,
    });
    return NextResponse.json({ ok: false, message: "媒体节点暂不可用" }, { status: 503 });
  }

  const response = NextResponse.json({
    ok: true,
    sessionId: result.lease.id,
    token: result.lease.token,
    expiresAt: result.lease.expiresAt,
    mediaUrl,
    manifest,
    format,
    segmentsPubliclyCacheable,
  });
  attachPlaybackViewerCookie(response, viewer);
  return response;
}

export async function PATCH(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  const viewer = playbackViewerFromRequest(request, user?.id || null);
  if (!viewer) return NextResponse.json({ ok: false }, { status: 401 });
  const input = await body(request);
  const expiresAt = refreshVideoPlaybackLease({
    id: input.sessionId,
    token: input.token,
    viewerKey: viewer.viewerKey,
    mediaId: input.mediaId,
  });
  return expiresAt
    ? NextResponse.json({ ok: true, expiresAt })
    : NextResponse.json({ ok: false, message: "播放会话已失效" }, { status: 404 });
}

export async function DELETE(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  const viewer = playbackViewerFromRequest(request, user?.id || null);
  if (!viewer) return NextResponse.json({ ok: true });
  const input = await body(request);
  releaseVideoPlaybackLease({
    id: input.sessionId,
    token: input.token,
    viewerKey: viewer.viewerKey,
    mediaId: input.mediaId,
  });
  return NextResponse.json({ ok: true });
}
