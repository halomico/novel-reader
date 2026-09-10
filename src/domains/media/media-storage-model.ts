import fs from "node:fs";
import path from "node:path";
import { getMediaDir } from "@/lib/config";
import { resolveMediaStoragePath } from "@/lib/media-storage-path";
import { normalizeMediaFolder, type MediaKind } from "./media-model";

const MEDIA_MIME_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".ts": "video/mp2t",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".zip": "application/zip",
};

const KIND_EXTENSIONS: Readonly<Record<Exclude<MediaKind, "file">, ReadonlySet<string>>> = {
  video: new Set([".mp4", ".m4v", ".mov", ".ogv", ".webm"]),
  audio: new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".webm"]),
};

export class MediaFolderError extends Error {}

export function normalizeMediaFolderName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  if (
    !name ||
    name.length > 100 ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(name) ||
    /[. ]$/u.test(name)
  ) {
    return null;
  }
  return name;
}

export function mediaStoredName(kind: MediaKind, folderValue: string, fileNameValue: string): string {
  const folder = normalizeMediaFolder(folderValue);
  const fileName = path.basename(fileNameValue.trim()).replace(/[\u0000-\u001f\u007f]/gu, "");
  if (folder === null || !fileName || fileName === "." || fileName === "..") {
    throw new MediaFolderError("资源路径无效");
  }
  return [kind, folder, fileName].filter(Boolean).join("/");
}

export function mediaFilePath(storedName: string): string {
  try {
    return resolveMediaStoragePath(getMediaDir(), storedName);
  } catch (error) {
    throw new MediaFolderError(error instanceof Error ? error.message : "资源路径无效");
  }
}

export function mediaFolderAbsolutePath(kind: MediaKind, folderValue: string): string {
  const folder = normalizeMediaFolder(folderValue);
  if (folder === null) throw new MediaFolderError("文件夹路径无效");
  return mediaFilePath([kind, folder].filter(Boolean).join("/"));
}

export function ensureLocalMediaDirectories(): void {
  const root = getMediaDir();
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, ".uploads"), { recursive: true });
  fs.mkdirSync(path.join(root, ".thumbnails"), { recursive: true });
  fs.mkdirSync(path.join(root, ".covers"), { recursive: true });
  for (const kind of ["video", "audio", "file"] satisfies MediaKind[]) {
    fs.mkdirSync(path.join(root, kind), { recursive: true });
  }
}

export function localMediaFolderExists(kind: MediaKind, folder: string): boolean {
  ensureLocalMediaDirectories();
  try {
    return fs.statSync(mediaFolderAbsolutePath(kind, folder)).isDirectory();
  } catch {
    return false;
  }
}

export function availableLocalMediaStoredName(
  kind: MediaKind,
  folder: string,
  fileName: string,
  indexedNames: ReadonlySet<string> = new Set(),
  excludedStoredName = "",
): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidateName = suffix === 1 ? fileName : `${baseName} (${suffix})${extension}`;
    const candidate = mediaStoredName(kind, folder, candidateName);
    if (
      candidate === excludedStoredName ||
      (!indexedNames.has(candidate) && !fs.existsSync(mediaFilePath(candidate)))
    ) {
      return candidate;
    }
  }
  throw new MediaFolderError("同名资源过多，请修改名称");
}

export function availableIndexedMediaStoredName(
  kind: MediaKind,
  folder: string,
  fileName: string,
  indexedNames: ReadonlySet<string>,
): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidateName = suffix === 1 ? fileName : `${baseName} (${suffix})${extension}`;
    const candidate = mediaStoredName(kind, folder, candidateName);
    if (!indexedNames.has(candidate)) return candidate;
  }
  throw new MediaFolderError("同名资源过多，请修改名称");
}

export function normalizeMediaFile(params: {
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  allowVideoConversionSources?: boolean;
}): { fileName: string; extension: string; mimeType: string } | null {
  const fileName = path.basename(params.fileName.trim()).replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 240);
  if (!fileName) return null;
  const extension = path.extname(fileName).toLowerCase().slice(0, 16);
  const conversionSource = params.kind === "video" && params.allowVideoConversionSources === true &&
    [".ts", ".mts", ".m2ts"].includes(extension);
  if (params.kind !== "file" && !KIND_EXTENSIONS[params.kind].has(extension) && !conversionSource) return null;
  const suppliedMime = params.mimeType.trim().toLowerCase();
  const mimeType = MEDIA_MIME_TYPES[extension] ||
    (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(suppliedMime) ? suppliedMime : "application/octet-stream");
  return { fileName, extension, mimeType };
}

export function normalizeMediaTitle(value: string, extension = ""): string | null {
  let title = value.trim();
  if (extension && title.toLowerCase().endsWith(extension.toLowerCase())) {
    title = title.slice(0, -extension.length).trim();
  }
  if (
    !title ||
    title.length > 120 ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(title) ||
    /[. ]$/u.test(title) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(title)
  ) {
    return null;
  }
  return title;
}
