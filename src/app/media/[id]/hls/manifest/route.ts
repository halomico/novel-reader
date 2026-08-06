import { NextRequest } from "next/server";
import { getVideoPlaybackAccess } from "@/lib/media-access";
import { checkContentAccess, hasScopedContentAccessControls } from "@/lib/content-access";
import {
  getMediaAsset,
  hasPublishedMediaHls,
  isMediaKindConsumable,
  isMediaKindContentPublic,
} from "@/lib/media";
import { readRemoteMediaPlaybackManifest } from "@/lib/media-node-client";
import { getMediaDir } from "@/lib/config";
import { isRemoteMediaStorage, resolveRemoteMediaNodeForAsset } from "@/lib/media-storage-config";
import { playbackViewerFromRequest } from "@/lib/playback-viewer";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { readPlaybackHlsManifest } from "@/lib/video-hls";
import { validateVideoPlaybackLease } from "@/lib/video-playback";
import { createSignedMediaHlsUrl } from "@/lib/media-signing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resourcePath(manifestPath: string, fileName: string): string | null {
  if (!/^(?:index\.m3u8|init\.mp4|bundle-[0-9]{4}\.m4s)$/u.test(fileName)) return null;
  const directory = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
  const value = `${directory}/${fileName}`.replace(/\\/g, "/");
  return value.startsWith("video/.hls/") && !value.includes("..") ? value : null;
}

function rewriteManifest(
  manifest: string,
  id: number,
  manifestPath: string,
  version: string,
  sessionId: string,
  token: string,
  remoteNodeId: string | null,
  publiclyAccessible: boolean,
): string {
  const rewrite = (fileName: string): string => {
    const path = resourcePath(manifestPath, fileName);
    if (!path) throw new Error("HLS 播放清单包含未知资源");
    if (remoteNodeId) {
      return createSignedMediaHlsUrl({ storageNodeId: remoteNodeId, storedPath: path, publiclyAccessible });
    }
    const params = new URLSearchParams({ file: fileName, v: version });
    if (!publiclyAccessible) {
      params.set("ps", sessionId);
      params.set("pt", token);
    }
    return `/media/${id}/hls/segment?${params.toString()}`;
  };
  return manifest
    .split(/\r?\n/u)
    .map((line) => {
      if (line.startsWith("#EXT-X-MAP:URI=\"")) {
        const match = /^#EXT-X-MAP:URI="([^"]+)"(.*)$/u.exec(line);
        if (!match) throw new Error("HLS 播放清单格式无效");
        return `#EXT-X-MAP:URI=\"${rewrite(match[1])}\"${match[2]}`;
      }
      if (!line || line.startsWith("#")) return line;
      return rewrite(line.trim());
    })
    .join("\n");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "video" || !isMediaKindConsumable("video", Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: "video",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) return new Response(null, { status: access.status });
  if (request.nextUrl.searchParams.get("v") !== asset.playbackVersion) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!hasPublishedMediaHls(asset) || !asset.playbackManifestPath) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const viewer = playbackViewerFromRequest(request, user?.id || null);
  const playbackAccess = getVideoPlaybackAccess(asset, user);
  const sessionId = request.nextUrl.searchParams.get("ps") || "";
  const token = request.nextUrl.searchParams.get("pt") || "";
  if (!viewer || !playbackAccess.allowed || !validateVideoPlaybackLease({
    id: sessionId,
    token,
    viewerKey: viewer.viewerKey,
    mediaId: asset.id,
  })) {
    return new Response(null, { status: 403 });
  }
  try {
    const manifest = isRemoteMediaStorage()
      ? await readRemoteMediaPlaybackManifest(resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id, asset.playbackManifestPath)
      : await readPlaybackHlsManifest(getMediaDir(), asset.playbackManifestPath);
    const remoteNodeId = isRemoteMediaStorage()
      ? resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id
      : null;
    const publiclyAccessible = asset.playSodaPrice === 0 &&
      isMediaKindContentPublic("video") &&
      !hasScopedContentAccessControls("video");
    const rewritten = rewriteManifest(
      manifest,
      asset.id,
      asset.playbackManifestPath,
      asset.playbackVersion,
      sessionId,
      token,
      remoteNodeId,
      publiclyAccessible,
    );
    return new Response(rewritten, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
        "Cache-Control": "private, no-store",
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        Vary: "Cookie",
      },
    });
  } catch {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
