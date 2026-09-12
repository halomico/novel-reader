import { NextRequest, NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { getPostgresVideoPlaybackAccess } from "@/domains/media/postgres-media-access";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import { hasPublishedMediaHls, isMediaKindConsumable } from "@/domains/media/media-model";
import {
  createPostgresVideoPlaybackLease,
  estimatePostgresVideoBitrateKbps,
  refreshPostgresVideoPlaybackLease,
  releasePostgresVideoPlaybackLease,
} from "@/domains/media/postgres-video-playback";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { getMediaNodePlaybackCapacity } from "@/lib/media-storage-config";
import { getVideoPlaybackMode } from "@/lib/video-playback-mode";
import { attachPlaybackViewerCookie, playbackViewerFromRequest } from "@/lib/playback-viewer";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import {
  buildAuthorizedPlaybackHlsManifest,
  hlsSegmentsPubliclyCacheable,
} from "@/lib/video-hls-delivery";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function body(request: NextRequest): Promise<{
  mediaId: number;
  clientId: string;
  sessionId: string;
  token: string;
  inlineHls: boolean;
}> {
  const parsed = await readJsonBody<Record<string, unknown>>(request, 16 * 1024);
  if (parsed.ok) {
    const value = parsed.value;
    return {
      mediaId: Number(value.mediaId),
      clientId: String(value.clientId || ""),
      sessionId: String(value.sessionId || ""),
      token: String(value.token || ""),
      inlineHls: value.inlineHls === true,
    };
  }
  return { mediaId: 0, clientId: "", sessionId: "", token: "", inlineHls: false };
}

/**
 * Mint a playback ticket.
 * hls.js clients can request the fully rewritten playlist inline and avoid a
 * second manifest round-trip. Native HLS clients receive the protected
 * playlist URL instead, so the manifest is only built once in either path.
 */
export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  const input = await body(request);
  const asset = await getPostgresMediaAsset(database("web"), input.mediaId);
  if (!asset || asset.kind !== "video" || !isMediaKindConsumable("video", Boolean(user))) {
    return NextResponse.json({ ok: false, message: "视频不存在" }, { status: 404 });
  }
  const access = await getPostgresVideoPlaybackAccess(database("web"), asset.id, user);
  if (!access || !access.allowed) {
    const loginRequired = access?.reason === "login_required";
    return NextResponse.json(
      { ok: false, message: loginRequired ? "请先登录" : "请先解锁视频" },
      { status: loginRequired ? 401 : 402 },
    );
  }
  const viewer = playbackViewerFromRequest(request, user?.id || null, true)!;
  const capacity = getMediaNodePlaybackCapacity(asset.storageNodeId, asset.kind);
  const result = await createPostgresVideoPlaybackLease({
    viewerKey: viewer.viewerKey,
    userId: user?.id || null,
    clientId: input.clientId,
    mediaId: asset.id,
    storageNodeId: capacity.storageNodeId,
    reservedKbps: estimatePostgresVideoBitrateKbps(asset),
    nodeMaxStreams: capacity.maxVideoStreams,
    nodeBandwidthKbps: capacity.bandwidthKbps,
  });
  if (!result.ok) {
    const message = result.reason === "not_allowed"
      ? "当前等级暂不能播放视频"
      : result.reason === "node_busy"
        ? "当前播放人数较多，请稍后重试"
        : "视频不存在";
    return NextResponse.json(
      { ok: false, message },
      {
        status: result.reason === "node_busy" ? 503 : 403,
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
      segmentsPubliclyCacheable = hlsSegmentsPubliclyCacheable(asset);
      if (input.inlineHls) {
        const built = await buildAuthorizedPlaybackHlsManifest(asset, {
          sessionId: result.lease.id,
          token: result.lease.token,
        });
        manifest = built.manifest;
      }
      const query = new URLSearchParams({
        v: asset.playbackVersion,
        ps: result.lease.id,
        pt: result.lease.token,
      });
      mediaUrl = `/media/${asset.id}/hls/manifest?${query.toString()}`;
      format = "hls";
    } else if (playbackMode === "hls-only") {
      await releasePostgresVideoPlaybackLease(database("web"), {
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
        estimatedKbps: estimatePostgresVideoBitrateKbps(asset),
        playbackSessionId: result.lease.id,
        playbackToken: result.lease.token,
      });
    }
  } catch {
    await releasePostgresVideoPlaybackLease(database("web"), {
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
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
  attachPlaybackViewerCookie(response, viewer);
  return response;
}

export async function PATCH(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  const viewer = playbackViewerFromRequest(request, user?.id || null);
  if (!viewer) return NextResponse.json({ ok: false }, { status: 401 });
  const input = await body(request);
  const expiresAt = await refreshPostgresVideoPlaybackLease(database("web"), {
    id: input.sessionId,
    token: input.token,
    viewerKey: viewer.viewerKey,
    mediaId: input.mediaId,
  });
  return expiresAt
    ? NextResponse.json({ ok: true, expiresAt }, { headers: { "Cache-Control": "private, no-store" } })
    : NextResponse.json({ ok: false, message: "播放会话已失效" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: NextRequest) {
  const guard = validateSameOriginMutation(request, { requireJson: false });
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  const viewer = playbackViewerFromRequest(request, user?.id || null);
  if (!viewer) return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  const input = await body(request);
  await releasePostgresVideoPlaybackLease(database("web"), {
    id: input.sessionId,
    token: input.token,
    viewerKey: viewer.viewerKey,
    mediaId: input.mediaId,
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
