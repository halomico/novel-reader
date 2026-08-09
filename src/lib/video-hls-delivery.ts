/**
 * HLS playback delivery: ticket-layer auth + cacheable segment URLs.
 *
 * Product model
 * - Catalog / metadata can be public (portal "公开展示").
 * - Starting playback requires login (and soda unlock when priced).
 * - Free (0 soda) segments use time-bucketed public signatures so CDN can HIT.
 * - Paid segments stay private (non-bucketed signatures / lease-bound local paths).
 *
 * Security goal: stop stable hotlink mirrors freeloading bandwidth, not personal link sharing.
 */

import { getMediaDir } from "./config";
import type { MediaAsset } from "./media";
import { hasPublishedMediaHls } from "./media";
import { readRemoteMediaPlaybackManifest } from "./media-node-client";
import { createSignedMediaHlsUrl } from "./media-signing";
import { isRemoteMediaStorage, resolveRemoteMediaNodeForAsset } from "./media-storage-config";
import { readPublishedPlaybackHlsManifest } from "./video-hls";

const PLAYBACK_HLS_RESOURCE = /^(?:index\.m3u8|init\.mp4|bundle-[0-9]{4}\.m4s)$/u;

/** In-process raw manifest cache (path + version). Avoids control-plane RTT on warm leases. */
const RAW_MANIFEST_TTL_MS = 5 * 60_000;
const RAW_MANIFEST_MAX_ENTRIES = 512;
const rawManifestCache = new Map<string, { expiresAt: number; text: string }>();
const rawManifestLoads = new Map<string, Promise<string>>();

export type HlsManifestRewriteInput = {
  mediaId: number;
  manifestPath: string;
  playbackVersion: string;
  /** Lease credentials for private (paid) local segment URLs. */
  sessionId: string;
  token: string;
  storageNodeId: string | null;
  /** When true, segment URLs are CDN-cacheable (time-bucketed public signatures). */
  segmentsPubliclyCacheable: boolean;
};

/**
 * Free published HLS may use public cacheable segment URLs.
 * Login is enforced when minting the playlist, not on every segment byte.
 */
export function hlsSegmentsPubliclyCacheable(
  asset: Pick<MediaAsset, "kind" | "playSodaPrice" | "playbackFormat" | "playbackVersion" | "playbackManifestPath">,
): boolean {
  return asset.kind === "video" &&
    asset.playSodaPrice <= 0 &&
    hasPublishedMediaHls(asset);
}

export function playbackHlsResourcePath(manifestPath: string, fileName: string): string | null {
  if (!PLAYBACK_HLS_RESOURCE.test(fileName)) return null;
  const slash = manifestPath.lastIndexOf("/");
  if (slash <= 0) return null;
  const value = `${manifestPath.slice(0, slash)}/${fileName}`.replace(/\\/g, "/");
  if (!value.startsWith("video/.hls/") || value.includes("..")) return null;
  return value;
}

/**
 * Rewrite a raw package manifest so every media URI is a playable absolute or site path.
 */
export function rewritePlaybackHlsManifest(rawManifest: string, input: HlsManifestRewriteInput): string {
  if (!rawManifest.startsWith("#EXTM3U")) {
    throw new Error("HLS 播放清单无效");
  }

  const rewriteUri = (fileName: string): string => {
    const storedPath = playbackHlsResourcePath(input.manifestPath, fileName);
    if (!storedPath) throw new Error("HLS 播放清单包含未知资源");

    if (isRemoteMediaStorage()) {
      const remoteNodeId = resolveRemoteMediaNodeForAsset(input.storageNodeId, "video").id;
      return createSignedMediaHlsUrl({
        storageNodeId: remoteNodeId,
        storedPath,
        publiclyAccessible: input.segmentsPubliclyCacheable,
      });
    }

    // Local / single-node: free segments omit lease (cacheable); paid keep lease query.
    const params = new URLSearchParams({
      file: fileName,
      v: input.playbackVersion,
    });
    if (!input.segmentsPubliclyCacheable) {
      params.set("ps", input.sessionId);
      params.set("pt", input.token);
    }
    return `/media/${input.mediaId}/hls/segment?${params.toString()}`;
  };

  return rawManifest
    .split(/\r?\n/u)
    .map((line) => {
      if (line.startsWith("#EXT-X-MAP:URI=\"")) {
        const match = /^#EXT-X-MAP:URI="([^"]+)"(.*)$/u.exec(line);
        if (!match) throw new Error("HLS 播放清单格式无效");
        return `#EXT-X-MAP:URI="${rewriteUri(match[1])}"${match[2]}`;
      }
      if (!line || line.startsWith("#")) return line;
      return rewriteUri(line.trim());
    })
    .join("\n");
}

function rawManifestCacheKey(manifestPath: string, playbackVersion: string): string {
  return `${playbackVersion}\n${manifestPath}`;
}

function readRawManifestCache(manifestPath: string, playbackVersion: string): string | null {
  const key = rawManifestCacheKey(manifestPath, playbackVersion);
  const hit = rawManifestCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    rawManifestCache.delete(key);
    return null;
  }
  // LRU touch
  rawManifestCache.delete(key);
  rawManifestCache.set(key, hit);
  return hit.text;
}

function writeRawManifestCache(manifestPath: string, playbackVersion: string, text: string): void {
  const key = rawManifestCacheKey(manifestPath, playbackVersion);
  rawManifestCache.set(key, { text, expiresAt: Date.now() + RAW_MANIFEST_TTL_MS });
  while (rawManifestCache.size > RAW_MANIFEST_MAX_ENTRIES) {
    const oldest = rawManifestCache.keys().next().value;
    if (oldest === undefined) break;
    rawManifestCache.delete(oldest);
  }
}

/** Test helper / maintenance. */
export function clearPlaybackHlsManifestCache(): void {
  rawManifestCache.clear();
  rawManifestLoads.clear();
}

export async function loadRawPlaybackHlsManifest(
  asset: Pick<MediaAsset, "storageNodeId" | "playbackManifestPath" | "playbackVersion" | "kind">,
): Promise<string> {
  const manifestPath = asset.playbackManifestPath;
  if (!manifestPath) {
    throw new Error("HLS 播放成品不存在");
  }
  const cached = readRawManifestCache(manifestPath, asset.playbackVersion);
  if (cached) return cached;

  const key = rawManifestCacheKey(manifestPath, asset.playbackVersion);
  const existing = rawManifestLoads.get(key);
  if (existing) return existing;

  const load = (async () => {
    const text = isRemoteMediaStorage()
      ? await readRemoteMediaPlaybackManifest(
        resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id,
        manifestPath,
      )
      : await readPublishedPlaybackHlsManifest(getMediaDir(), manifestPath);

    if (!text.startsWith("#EXTM3U")) {
      throw new Error("HLS 播放清单无效");
    }
    writeRawManifestCache(manifestPath, asset.playbackVersion, text);
    return text;
  })();
  rawManifestLoads.set(key, load);
  try {
    return await load;
  } finally {
    if (rawManifestLoads.get(key) === load) {
      rawManifestLoads.delete(key);
    }
  }
}

/**
 * Build a client-ready playlist after the caller has authorized playback.
 */
export async function buildAuthorizedPlaybackHlsManifest(
  asset: MediaAsset,
  lease: { sessionId: string; token: string },
): Promise<{ manifest: string; segmentsPubliclyCacheable: boolean }> {
  if (!hasPublishedMediaHls(asset) || !asset.playbackManifestPath) {
    throw new Error("HLS 播放成品不存在");
  }
  const segmentsPubliclyCacheable = hlsSegmentsPubliclyCacheable(asset);
  const raw = await loadRawPlaybackHlsManifest(asset);
  const manifest = rewritePlaybackHlsManifest(raw, {
    mediaId: asset.id,
    manifestPath: asset.playbackManifestPath,
    playbackVersion: asset.playbackVersion,
    sessionId: lease.sessionId,
    token: lease.token,
    storageNodeId: asset.storageNodeId,
    segmentsPubliclyCacheable,
  });
  return { manifest, segmentsPubliclyCacheable };
}
