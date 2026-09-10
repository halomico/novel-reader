import {
  canBrowseHomePortalContent,
  canConsumeHomePortalContent,
  canSeeHomePortalContentEntry,
} from "@/lib/config";
import { normalizeMediaStoragePath } from "@/lib/media-storage-path";

export type MediaKind = "video" | "audio" | "file";
export type FeedbackMediaKind = Extract<MediaKind, "video" | "audio">;
export type MediaSortBy = "name" | "published" | "duration" | "size" | "updated" | "plays";
export type MediaSortOrder = "asc" | "desc";

export type MediaAsset = Readonly<{
  id: number;
  kind: MediaKind;
  storageNodeId: string | null;
  categoryId: number | null;
  title: string;
  artist: string;
  description: string;
  fileName: string;
  storedName: string;
  folder: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  durationSeconds: number | null;
  thumbnailVersion: number;
  customCoverKey: string | null;
  playbackFormat: "mp4" | "hls";
  playbackVersion: string;
  playbackManifestPath: string | null;
  playbackStatus: "none" | "pending" | "processing" | "ready" | "failed";
  playbackError: string;
  playbackPublishedAt: string | null;
  playCount: number;
  recommendCount: number;
  downloadCount: number;
  publishedAt: string;
  contentUpdatedAt: string;
  newUntil: string | null;
  playSodaPrice: number;
  downloadSodaPrice: number;
  createdAt: string;
  updatedAt: string;
}>;

export type VideoCategory = Readonly<{
  id: number;
  name: string;
  sortOrder: number;
  visible: boolean;
  videoCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type VideoTag = Readonly<{
  id: number;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  visible: boolean;
  videoCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type MediaFolder = Readonly<{
  path: string;
  name: string;
  depth: number;
  directAssets: number;
  totalAssets: number;
  totalSizeBytes: number;
  mtimeMs: number;
}>;

const MEDIA_KINDS: readonly MediaKind[] = ["video", "audio", "file"];

export function isMediaKind(value: unknown): value is MediaKind {
  return value === "video" || value === "audio" || value === "file";
}

export function isFeedbackMediaKind(kind: MediaKind): kind is FeedbackMediaKind {
  return kind === "video" || kind === "audio";
}

export function isMediaKindPublic(kind: MediaKind): boolean {
  return canBrowseHomePortalContent(kind, false);
}

export function isMediaKindAccessible(kind: MediaKind, authenticated: boolean): boolean {
  return canBrowseHomePortalContent(kind, authenticated);
}

export function isMediaKindEntryVisible(kind: MediaKind, authenticated: boolean): boolean {
  return canSeeHomePortalContentEntry(kind, authenticated);
}

export function isMediaKindConsumable(kind: MediaKind, authenticated: boolean): boolean {
  return canConsumeHomePortalContent(kind, authenticated);
}

export function isMediaKindContentPublic(kind: MediaKind): boolean {
  return canConsumeHomePortalContent(kind, false);
}

export function getAccessibleMediaKinds(authenticated: boolean): MediaKind[] {
  return MEDIA_KINDS.filter((kind) => isMediaKindAccessible(kind, authenticated));
}

export function getVisibleMediaEntryKinds(authenticated: boolean): MediaKind[] {
  return MEDIA_KINDS.filter((kind) => isMediaKindEntryVisible(kind, authenticated));
}

export function hasPublishedMediaHls(
  asset: Pick<MediaAsset, "playbackFormat" | "playbackVersion" | "playbackManifestPath">,
): boolean {
  return asset.playbackFormat === "hls" && Boolean(asset.playbackVersion) && Boolean(asset.playbackManifestPath);
}

export function mediaThumbnailVersion(sourceVersion: number, percent: number): number {
  return Math.max(Math.floor(sourceVersion), 0) * 101 + Math.min(Math.max(Math.floor(percent), 0), 100);
}

export function normalizeMediaFolder(value: unknown): string | null {
  return normalizeMediaStoragePath(value);
}

export function mediaFolderFromStoredName(storedName: string, kind: MediaKind): string {
  const prefix = `${kind}/`;
  const normalized = storedName.replace(/\\/gu, "/");
  if (!normalized.startsWith(prefix)) return "";
  const relativeFile = normalized.slice(prefix.length);
  const slashIndex = relativeFile.lastIndexOf("/");
  return slashIndex < 0 ? "" : relativeFile.slice(0, slashIndex);
}

export function normalizeMediaSortBy(value: string | undefined): MediaSortBy {
  return value === "published" || value === "duration" || value === "size" || value === "updated" || value === "plays"
    ? value
    : "name";
}

export function normalizeMediaSortOrder(value: string | undefined, sortBy: MediaSortBy): MediaSortOrder {
  return value === "asc" || value === "desc" ? value : sortBy === "name" ? "asc" : "desc";
}

export function sortMediaFolders(folders: readonly MediaFolder[], sortBy: MediaSortBy, sortOrder: MediaSortOrder): MediaFolder[] {
  const direction = sortOrder === "asc" ? 1 : -1;
  return [...folders].sort((left, right) => {
    let compared = 0;
    if (sortBy === "size") compared = left.totalSizeBytes - right.totalSizeBytes;
    else if (sortBy === "duration") compared = left.totalAssets - right.totalAssets;
    else if (sortBy === "updated") compared = left.mtimeMs - right.mtimeMs;
    else compared = left.name.localeCompare(right.name, "zh-CN", { numeric: true });
    return compared ? compared * direction : left.path.localeCompare(right.path, "zh-CN", { numeric: true });
  });
}

export type ByteRange = Readonly<{ start: number; end: number }>;

export function parseMediaByteRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}
