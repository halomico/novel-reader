import type { MediaAsset } from "@/domains/media/media-model";

export function mediaCoverVersion(asset: Pick<MediaAsset, "customCoverKey" | "mtimeMs">, percent: number): string {
  return asset.customCoverKey
    ? `custom-${asset.customCoverKey}`
    : `auto-${Math.floor(asset.mtimeMs)}-${Math.min(Math.max(Math.floor(percent), 1), 99)}`;
}
