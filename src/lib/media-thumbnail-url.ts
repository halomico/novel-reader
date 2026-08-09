import { mediaThumbnailVersion, type MediaAsset } from "./media";
import { createSignedMediaCoverUrl, createSignedMediaThumbnailUrl } from "./media-signing";
import { isRemoteMediaStorage, resolveRemoteMediaNodeForAsset } from "./media-storage-config";

export function directMediaThumbnailUrl(
  asset: MediaAsset,
  percent: number,
  publiclyAccessible: boolean,
): string | null {
  if (asset.kind !== "video" || !isRemoteMediaStorage()) return null;
  const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
  if (asset.customCoverKey) {
    return createSignedMediaCoverUrl({
      storageNodeId: node.id,
      key: asset.customCoverKey,
      publiclyAccessible,
    });
  }
  if (asset.thumbnailVersion !== mediaThumbnailVersion(asset.mtimeMs, percent)) {
    return null;
  }
  return createSignedMediaThumbnailUrl({
    storageNodeId: node.id,
    storedName: asset.storedName,
    mtimeMs: asset.mtimeMs,
    sizeBytes: asset.sizeBytes,
    percent,
    publiclyAccessible,
  });
}
