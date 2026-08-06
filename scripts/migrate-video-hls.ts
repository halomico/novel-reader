import "dotenv/config";
import fs from "node:fs";
import { getMediaDir } from "../src/lib/config";
import { getDb } from "../src/lib/db";
import {
  getMediaAsset,
  mediaFilePath,
  recoverStaleMediaPlaybackPreparations,
  requestMediaPlaybackPreparation,
  type MediaAsset,
} from "../src/lib/media";
import {
  deleteRemoteMediaAssets,
  verifyRemoteMediaPlayback,
} from "../src/lib/media-node-client";
import { prepareMediaPlaybackAsset } from "../src/lib/media-playback-preparation";
import {
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "../src/lib/media-storage-config";
import { getVideoPlaybackMode } from "../src/lib/video-playback-mode";
import {
  mediaPlaybackSourceVersion,
  verifyPlaybackHls,
} from "../src/lib/video-hls";

const prepare = process.argv.includes("--prepare");
const verify = process.argv.includes("--verify");
const purge = process.argv.includes("--purge-sources");
const purgeConfirmed = process.argv.includes("--confirm-purge=DELETE_SOURCE_MP4");

function numericArgument(name: string, fallback: number): number {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=", 2)[1];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function ready(asset: MediaAsset): boolean {
  const version = mediaPlaybackSourceVersion(asset.mtimeMs, asset.sizeBytes);
  return asset.playbackStatus === "ready" &&
    asset.playbackFormat === "hls" &&
    asset.playbackVersion === version &&
    Boolean(asset.playbackManifestPath);
}

function preparationGroup(asset: MediaAsset): string {
  return isRemoteMediaStorage()
    ? resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id
    : "local";
}

async function verifyAsset(asset: MediaAsset): Promise<{
  sizeBytes: number;
  fileCount: number;
  durationSeconds: number;
}> {
  if (!ready(asset) || !asset.playbackManifestPath) {
    throw new Error("HLS 成品尚未发布");
  }
  if (isRemoteMediaStorage()) {
    const result = await verifyRemoteMediaPlayback(
      resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id,
      asset.playbackManifestPath,
    );
    verifyPlaybackDuration(asset, result.durationSeconds);
    return result;
  }
  const result = await verifyPlaybackHls(getMediaDir(), asset.playbackManifestPath);
  verifyPlaybackDuration(asset, result.durationSeconds);
  return result;
}

function verifyPlaybackDuration(asset: MediaAsset, durationSeconds: number): void {
  if (!asset.durationSeconds || asset.durationSeconds <= 0) return;
  const tolerance = Math.max(12, asset.durationSeconds * 0.02);
  if (Math.abs(durationSeconds - asset.durationSeconds) > tolerance) {
    throw new Error("HLS 成品时长与源视频不一致");
  }
}

async function prepareGroup(assets: MediaAsset[]): Promise<{ completed: number; failed: number }> {
  let completed = 0;
  let failed = 0;
  for (const asset of assets) {
    const current = getMediaAsset(asset.id);
    if (!current || current.kind !== "video") continue;
    if (ready(current)) {
      completed += 1;
      console.info(`ready   #${current.id} ${current.title}`);
      continue;
    }
    if (current.playbackStatus !== "pending") {
      requestMediaPlaybackPreparation(current, current.playbackStatus === "failed");
    }
    console.info(`prepare #${current.id} ${current.title}`);
    if (await prepareMediaPlaybackAsset(current.id)) {
      completed += 1;
    } else {
      failed += 1;
      console.error(`failed  #${current.id} ${current.title}`);
    }
  }
  return { completed, failed };
}

async function purgeSource(asset: MediaAsset): Promise<boolean> {
  await verifyAsset(asset);
  if (!asset.customCoverKey && asset.thumbnailVersion <= 0) {
    throw new Error("封面尚未准备，拒绝删除源 MP4");
  }
  if (!asset.durationSeconds || asset.durationSeconds <= 0) {
    throw new Error("时长尚未写入，拒绝删除源 MP4");
  }
  if (isRemoteMediaStorage()) {
    const nodeId = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id;
    const result = await deleteRemoteMediaAssets(nodeId, [asset.storedName]);
    return result.deletedStoredNames.includes(asset.storedName);
  }
  const sourcePath = mediaFilePath(asset.storedName);
  if (!fs.existsSync(sourcePath)) return true;
  await fs.promises.rm(sourcePath);
  return !fs.existsSync(sourcePath);
}

async function main() {
  if (![prepare, verify, purge].some(Boolean)) {
    throw new Error("请指定 --prepare、--verify 或 --purge-sources");
  }
  if (purge && (!purgeConfirmed || getVideoPlaybackMode() !== "hls-only")) {
    throw new Error(
      "清理源 MP4 前必须设置 VIDEO_PLAYBACK_MODE=hls-only，并显式传入 --confirm-purge=DELETE_SOURCE_MP4",
    );
  }
  recoverStaleMediaPlaybackPreparations(
    new Date(Date.now() - 5 * 60_000).toISOString().replace("T", " ").replace("Z", ""),
  );
  const limit = Math.min(numericArgument("limit", 100_000), 100_000);
  const fromId = numericArgument("from-id", 1);
  const ids = (getDb().prepare(
    `SELECT id FROM media_assets WHERE kind = 'video' AND id >= ? ORDER BY id ASC LIMIT ?`,
  ).all(fromId, limit) as Array<{ id: number }>).map((row) => row.id);
  const assets = ids
    .map((id) => getMediaAsset(id))
    .filter((asset): asset is MediaAsset => Boolean(asset?.kind === "video"));

  let failed = 0;
  if (prepare) {
    const groups = new Map<string, MediaAsset[]>();
    for (const asset of assets) {
      const key = preparationGroup(asset);
      groups.set(key, [...(groups.get(key) || []), asset]);
    }
    const results = await Promise.all(Array.from(groups.values()).map(prepareGroup));
    failed += results.reduce((total, result) => total + result.failed, 0);
  }

  if (verify || purge) {
    for (const original of assets) {
      const asset = getMediaAsset(original.id);
      if (!asset) continue;
      try {
        const info = await verifyAsset(asset);
        console.info(`verified #${asset.id} ${info.fileCount} files ${info.sizeBytes} bytes`);
        if (purge) {
          if (!await purgeSource(asset)) throw new Error("源 MP4 删除失败");
          console.info(`purged   #${asset.id} ${asset.storedName}`);
        }
      } catch (error) {
        failed += 1;
        console.error(
          `failed   #${asset.id} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  console.info(`summary: ${assets.length} selected, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
