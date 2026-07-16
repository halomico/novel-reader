import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getMediaDir,
  isAudioLibraryEnabled,
  isFileLibraryEnabled,
  isGuestAudioNavEnabled,
  isGuestFileNavEnabled,
  isGuestVideoNavEnabled,
  isVideoLibraryEnabled,
} from "./config";
import { getDb } from "./db";

export type MediaKind = "video" | "audio" | "file";
export type MediaSortBy = "name" | "size" | "updated";
export type MediaSortOrder = "asc" | "desc";

export type MediaAsset = {
  id: number;
  kind: MediaKind;
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
  playCount: number;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MediaFolder = {
  path: string;
  name: string;
  depth: number;
  directAssets: number;
  totalSizeBytes: number;
  mtimeMs: number;
};

export type MediaSyncResult = {
  added: number;
  updated: number;
  removed: number;
};

type MediaRow = {
  id: number;
  kind: MediaKind;
  title: string;
  artist: string;
  description: string;
  file_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  mtime_ms: number;
  duration_seconds: number | null;
  play_count: number;
  download_count: number;
  created_at: string;
  updated_at: string;
};

type ScannedMediaFile = {
  kind: MediaKind;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
};

type ScannedMediaLibrary = {
  files: Map<string, ScannedMediaFile>;
  folders: Record<MediaKind, Array<{ path: string; mtimeMs: number }>>;
};

type MediaLibrarySyncState = {
  directory: string;
  syncedAt: number;
  prepared: boolean;
  running?: Promise<MediaSyncResult>;
  folders: Record<MediaKind, Array<{ path: string; mtimeMs: number }>>;
};

type MediaGlobal = typeof globalThis & {
  mediaLibrarySyncState?: MediaLibrarySyncState;
};

export class MediaFolderError extends Error {}

export const MEDIA_SYNC_INTERVAL_MS = 5 * 60 * 1_000;
const MEDIA_KINDS: MediaKind[] = ["video", "audio", "file"];

const MEDIA_MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
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
  ".txt": "text/plain",
  ".zip": "application/zip",
};

const KIND_EXTENSIONS: Record<Exclude<MediaKind, "file">, Set<string>> = {
  video: new Set([".mp4", ".m4v", ".mov", ".ogv", ".webm"]),
  audio: new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".webm"]),
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizeMediaFolder(value: unknown): string | null {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = toPosixPath(value.trim()).replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return "";
  }
  if (normalized.length > 600 || normalized.includes("\u0000")) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

function normalizeFolderName(value: string): string | null {
  const name = value.trim();
  if (!name || name.length > 100 || name === "." || name === ".." || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)) {
    return null;
  }
  return name;
}

export function mediaStoredName(kind: MediaKind, folder: string, fileName: string): string {
  const normalizedFolder = normalizeMediaFolder(folder);
  const safeFileName = path.basename(fileName.trim()).replace(/[\u0000-\u001f\u007f]/g, "");
  if (normalizedFolder === null || !safeFileName || safeFileName === "." || safeFileName === "..") {
    throw new MediaFolderError("资源路径无效");
  }
  return [kind, normalizedFolder, safeFileName].filter(Boolean).join("/");
}

export function mediaFilePath(storedName: string): string {
  const normalized = normalizeMediaFolder(storedName);
  if (!normalized) {
    throw new MediaFolderError("资源路径无效");
  }
  const root = path.resolve(getMediaDir());
  const target = path.resolve(root, ...normalized.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new MediaFolderError("资源路径超出媒体目录");
  }
  return target;
}

export function mediaFolderFromStoredName(storedName: string, kind: MediaKind): string {
  const prefix = `${kind}/`;
  const normalized = toPosixPath(storedName);
  if (!normalized.startsWith(prefix)) {
    return "";
  }
  const relativeFile = normalized.slice(prefix.length);
  const slashIndex = relativeFile.lastIndexOf("/");
  return slashIndex < 0 ? "" : relativeFile.slice(0, slashIndex);
}

function toAsset(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    artist: row.artist,
    description: row.description,
    fileName: row.file_name,
    storedName: row.stored_name,
    folder: mediaFolderFromStoredName(row.stored_name, row.kind),
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    durationSeconds: row.duration_seconds,
    playCount: row.play_count,
    downloadCount: row.download_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isMediaKind(value: unknown): value is MediaKind {
  return value === "video" || value === "audio" || value === "file";
}

export function isMediaKindEnabled(kind: MediaKind): boolean {
  if (kind === "video") {
    return isVideoLibraryEnabled();
  }
  if (kind === "audio") {
    return isAudioLibraryEnabled();
  }
  return isFileLibraryEnabled();
}

export function getEnabledMediaKinds(): MediaKind[] {
  return MEDIA_KINDS.filter(isMediaKindEnabled);
}

export function isMediaKindPublic(kind: MediaKind): boolean {
  if (!isMediaKindEnabled(kind)) return false;
  if (kind === "video") return isGuestVideoNavEnabled();
  if (kind === "audio") return isGuestAudioNavEnabled();
  return isGuestFileNavEnabled();
}

export function isMediaKindAccessible(kind: MediaKind, authenticated: boolean): boolean {
  return authenticated ? isMediaKindEnabled(kind) : isMediaKindPublic(kind);
}

export function getAccessibleMediaKinds(authenticated: boolean): MediaKind[] {
  return MEDIA_KINDS.filter((kind) => isMediaKindAccessible(kind, authenticated));
}

export function normalizeMediaFile(params: { kind: MediaKind; fileName: string; mimeType: string }): {
  fileName: string;
  extension: string;
  mimeType: string;
} | null {
  const fileName = path.basename(params.fileName.trim()).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240);
  if (!fileName) {
    return null;
  }
  const extension = path.extname(fileName).toLowerCase().slice(0, 16);
  if (params.kind !== "file" && !KIND_EXTENSIONS[params.kind].has(extension)) {
    return null;
  }
  const suppliedMime = params.mimeType.trim().toLowerCase();
  const mimeType = MEDIA_MIME_TYPES[extension] || (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(suppliedMime) ? suppliedMime : "application/octet-stream");
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
    /[<>:"/\\|?*\u0000-\u001f]/.test(title) ||
    /[. ]$/.test(title) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(title)
  ) {
    return null;
  }
  return title;
}

export function createStoredMediaName(extension: string): string {
  return `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension}`;
}

function emptyFolderSnapshot(): MediaLibrarySyncState["folders"] {
  return { video: [], audio: [], file: [] };
}

function getMediaLibrarySyncState(): MediaLibrarySyncState {
  const directory = path.resolve(getMediaDir());
  const globalState = globalThis as MediaGlobal;
  if (!globalState.mediaLibrarySyncState || globalState.mediaLibrarySyncState.directory !== directory) {
    globalState.mediaLibrarySyncState = {
      directory,
      syncedAt: 0,
      prepared: false,
      folders: emptyFolderSnapshot(),
    };
  }
  return globalState.mediaLibrarySyncState;
}

function markMediaLibraryDirty() {
  getMediaLibrarySyncState().syncedAt = 0;
}

function rememberMediaFolder(kind: MediaKind, folder: string) {
  if (!folder) {
    return;
  }
  const state = getMediaLibrarySyncState();
  const known = new Map(state.folders[kind].map((item) => [item.path, item.mtimeMs]));
  const segments = folder.split("/");
  for (let index = 1; index <= segments.length; index += 1) {
    const folderPath = segments.slice(0, index).join("/");
    if (!known.has(folderPath)) {
      known.set(folderPath, Date.now());
    }
  }
  state.folders[kind] = Array.from(known, ([folderPath, mtimeMs]) => ({ path: folderPath, mtimeMs }));
}

function renameRememberedMediaFolder(kind: MediaKind, folder: string, nextFolder: string) {
  const state = getMediaLibrarySyncState();
  state.folders[kind] = state.folders[kind].map((item) => {
    if (item.path === folder) {
      return { ...item, path: nextFolder };
    }
    if (item.path.startsWith(`${folder}/`)) {
      return { ...item, path: `${nextFolder}${item.path.slice(folder.length)}` };
    }
    return item;
  });
  rememberMediaFolder(kind, nextFolder);
}

function forgetMediaFolder(kind: MediaKind, folder: string) {
  const state = getMediaLibrarySyncState();
  state.folders[kind] = state.folders[kind].filter((item) => item.path !== folder && !item.path.startsWith(`${folder}/`));
}

function ensureMediaDirectories() {
  fs.mkdirSync(getMediaDir(), { recursive: true });
  fs.mkdirSync(path.join(getMediaDir(), ".uploads"), { recursive: true });
  fs.mkdirSync(path.join(getMediaDir(), ".thumbnails"), { recursive: true });
  for (const kind of MEDIA_KINDS) {
    fs.mkdirSync(path.join(getMediaDir(), kind), { recursive: true });
  }
}

export function availableMediaStoredName(kind: MediaKind, folder: string, fileName: string, excludeStoredName = ""): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidateFileName = suffix === 1 ? fileName : `${baseName} (${suffix})${extension}`;
    const candidate = mediaStoredName(kind, folder, candidateFileName);
    if (candidate === excludeStoredName || !fs.existsSync(mediaFilePath(candidate))) {
      return candidate;
    }
  }
  throw new MediaFolderError("同名资源过多，请修改名称");
}

function migrateFlatMediaAssets() {
  const rows = getDb().prepare("SELECT id, kind, stored_name FROM media_assets").all() as Array<{
    id: number;
    kind: MediaKind;
    stored_name: string;
  }>;
  const update = getDb().prepare("UPDATE media_assets SET stored_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  for (const row of rows) {
    if (toPosixPath(row.stored_name).startsWith(`${row.kind}/`)) {
      continue;
    }
    let destinationStoredName = mediaStoredName(row.kind, "", path.basename(row.stored_name));
    const sourcePath = mediaFilePath(row.stored_name);
    let destinationPath = mediaFilePath(destinationStoredName);
    if (fs.existsSync(sourcePath)) {
      if (fs.existsSync(destinationPath)) {
        const extension = path.extname(row.stored_name).toLowerCase();
        destinationStoredName = mediaStoredName(row.kind, "", createStoredMediaName(extension));
        destinationPath = mediaFilePath(destinationStoredName);
      }
      fs.renameSync(sourcePath, destinationPath);
      update.run(destinationStoredName, row.id);
    } else if (fs.existsSync(destinationPath)) {
      update.run(destinationStoredName, row.id);
    }
  }
}

function migrateGeneratedMediaFileNames() {
  const rows = getDb().prepare("SELECT * FROM media_assets").all() as MediaRow[];
  for (const row of rows) {
    const currentFileName = path.basename(row.stored_name);
    if (!/^\d{10,}-[a-f0-9]{24}\.[^.]+$/i.test(currentFileName)) {
      continue;
    }
    const extension = path.extname(currentFileName);
    const title = normalizeMediaTitle(row.title, extension);
    const sourcePath = mediaFilePath(row.stored_name);
    if (!title || !fs.existsSync(sourcePath)) {
      continue;
    }
    const folder = mediaFolderFromStoredName(row.stored_name, row.kind);
    const nextStoredName = availableMediaStoredName(row.kind, folder, `${title}${extension}`, row.stored_name);
    if (nextStoredName === row.stored_name) {
      continue;
    }
    const nextFileName = path.basename(nextStoredName);
    const nextTitle = path.basename(nextFileName, path.extname(nextFileName));
    const targetPath = mediaFilePath(nextStoredName);
    fs.renameSync(sourcePath, targetPath);
    try {
      getDb().exec("BEGIN");
      getDb()
        .prepare("UPDATE media_assets SET title = ?, file_name = ?, stored_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(nextTitle, nextFileName, nextStoredName, row.id);
      getDb().prepare("UPDATE user_media_history SET title = ? WHERE media_id = ?").run(nextTitle, row.id);
      getDb().exec("COMMIT");
    } catch (error) {
      getDb().exec("ROLLBACK");
      fs.renameSync(targetPath, sourcePath);
      throw error;
    }
  }
}

async function scanMediaFiles(): Promise<ScannedMediaLibrary> {
  const files = new Map<string, ScannedMediaFile>();
  const folders = emptyFolderSnapshot();
  const visit = async (kind: MediaKind, directory: string, relativeFolder = "") => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const folderPath = [relativeFolder, entry.name].filter(Boolean).join("/");
        const stat = await fs.promises.stat(absolutePath);
        folders[kind].push({ path: folderPath, mtimeMs: Math.floor(stat.mtimeMs) });
        await visit(kind, absolutePath, folderPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const normalizedFile = normalizeMediaFile({ kind, fileName: entry.name, mimeType: "" });
      if (!normalizedFile) {
        continue;
      }
      const stat = await fs.promises.stat(absolutePath);
      const storedName = toPosixPath(path.relative(getMediaDir(), absolutePath));
      files.set(storedName, {
        kind,
        fileName: normalizedFile.fileName,
        storedName,
        mimeType: normalizedFile.mimeType,
        sizeBytes: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
      });
    }
  };

  for (const kind of MEDIA_KINDS) {
    await visit(kind, path.join(getMediaDir(), kind));
  }
  return { files, folders };
}

function removeThumbnailFile(id: number) {
  const directory = path.join(getMediaDir(), ".thumbnails");
  if (!fs.existsSync(directory)) {
    return;
  }
  for (const fileName of fs.readdirSync(directory)) {
    if (fileName === `${id}.jpg` || fileName.startsWith(`${id}-`)) {
      fs.rmSync(path.join(directory, fileName), { force: true });
    }
  }
}

async function performMediaLibrarySync(state: MediaLibrarySyncState): Promise<MediaSyncResult> {
  const startedAt = Date.now();
  ensureMediaDirectories();
  if (!state.prepared) {
    migrateFlatMediaAssets();
    migrateGeneratedMediaFileNames();
    state.prepared = true;
  }
  const scannedLibrary = await scanMediaFiles();
  const scanned = scannedLibrary.files;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM media_assets").all() as MediaRow[];
  const existing = new Map(rows.map((row) => [row.stored_name, row]));
  const missingRows = rows.filter((row) => {
    if (scanned.has(row.stored_name)) {
      return false;
    }
    try {
      return !fs.existsSync(mediaFilePath(row.stored_name));
    } catch {
      return true;
    }
  });
  const newFiles = Array.from(scanned.values()).filter((file) => !existing.has(file.storedName));
  const identity = (item: { kind: MediaKind; sizeBytes?: number; size_bytes?: number; mtimeMs?: number; mtime_ms?: number; fileName?: string; file_name?: string }) => {
    const size = item.sizeBytes ?? item.size_bytes ?? -1;
    const mtime = item.mtimeMs ?? item.mtime_ms ?? -1;
    const fileName = item.fileName ?? item.file_name ?? "";
    return `${item.kind}:${size}:${mtime}:${path.extname(fileName).toLowerCase()}`;
  };
  const missingByIdentity = new Map<string, MediaRow[]>();
  const newByIdentity = new Map<string, ScannedMediaFile[]>();
  for (const row of missingRows) {
    const key = identity(row);
    missingByIdentity.set(key, [...(missingByIdentity.get(key) || []), row]);
  }
  for (const file of newFiles) {
    const key = identity(file);
    newByIdentity.set(key, [...(newByIdentity.get(key) || []), file]);
  }
  const renamedPairs: Array<{ row: MediaRow; file: ScannedMediaFile }> = [];
  for (const [key, oldRows] of missingByIdentity) {
    const nextFiles = newByIdentity.get(key) || [];
    if (oldRows.length === 1 && nextFiles.length === 1 && oldRows[0].mtime_ms > 0) {
      renamedPairs.push({ row: oldRows[0], file: nextFiles[0] });
    }
  }
  const renamedIds = new Set(renamedPairs.map((pair) => pair.row.id));
  const renamedStoredNames = new Set(renamedPairs.map((pair) => pair.file.storedName));
  const removedRows = missingRows.filter((row) => !renamedIds.has(row.id));
  let added = 0;
  let updated = 0;

  db.exec("BEGIN");
  try {
    const insert = db.prepare(
      `INSERT INTO media_assets (kind, title, artist, description, file_name, stored_name, mime_type, size_bytes, mtime_ms)
       VALUES (?, ?, '', '', ?, ?, ?, ?, ?)`,
    );
    const update = db.prepare(
      `UPDATE media_assets
       SET title = ?, file_name = ?, mime_type = ?, size_bytes = ?, mtime_ms = ?,
           duration_seconds = CASE WHEN size_bytes <> ? OR mtime_ms <> ? THEN NULL ELSE duration_seconds END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );
    const updateRename = db.prepare(
      `UPDATE media_assets
       SET title = ?, file_name = ?, stored_name = ?, mime_type = ?, size_bytes = ?, mtime_ms = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );
    const updateHistoryTitle = db.prepare("UPDATE user_media_history SET title = ? WHERE media_id = ?");
    for (const { row, file } of renamedPairs) {
      const title = path.basename(file.fileName, path.extname(file.fileName));
      updateRename.run(title, file.fileName, file.storedName, file.mimeType, file.sizeBytes, file.mtimeMs, row.id);
      updateHistoryTitle.run(title, row.id);
      updated += 1;
    }
    for (const file of scanned.values()) {
      const row = existing.get(file.storedName);
      if (!row && !renamedStoredNames.has(file.storedName)) {
        insert.run(
          file.kind,
          path.basename(file.fileName, path.extname(file.fileName)),
          file.fileName,
          file.storedName,
          file.mimeType,
          file.sizeBytes,
          file.mtimeMs,
        );
        added += 1;
      } else if (row && (
        row.file_name !== file.fileName ||
        row.mime_type !== file.mimeType ||
        row.size_bytes !== file.sizeBytes ||
        row.mtime_ms !== file.mtimeMs
      )) {
        const title = row.file_name === file.fileName ? row.title : path.basename(file.fileName, path.extname(file.fileName));
        update.run(title, file.fileName, file.mimeType, file.sizeBytes, file.mtimeMs, file.sizeBytes, file.mtimeMs, row.id);
        if (title !== row.title) {
          updateHistoryTitle.run(title, row.id);
        }
        updated += 1;
      }
    }
    if (removedRows.length) {
      const placeholders = removedRows.map(() => "?").join(", ");
      db.prepare(`DELETE FROM media_assets WHERE id IN (${placeholders})`).run(...removedRows.map((row) => row.id));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  for (const row of removedRows) {
    removeThumbnailFile(row.id);
  }
  state.folders = scannedLibrary.folders;
  state.syncedAt = Date.now();
  const result = { added, updated, removed: removedRows.length };
  const elapsedMs = state.syncedAt - startedAt;
  if (elapsedMs >= 1_000 || added || updated || removedRows.length) {
    console.info(`[media] library sync ${elapsedMs}ms: +${added} ~${updated} -${removedRows.length}`);
  }
  return result;
}

export function syncMediaLibrary(options: { force?: boolean } = {}): Promise<MediaSyncResult> {
  const state = getMediaLibrarySyncState();
  const now = Date.now();
  if (state.running) {
    return state.running;
  }
  if (!options.force && now - state.syncedAt < MEDIA_SYNC_INTERVAL_MS) {
    return Promise.resolve({ added: 0, updated: 0, removed: 0 });
  }

  const job = performMediaLibrarySync(state);
  state.running = job;
  void job.finally(() => {
    if (state.running === job) {
      delete state.running;
    }
  }).catch(() => undefined);
  return job;
}

export function createMediaAsset(params: {
  kind: MediaKind;
  title: string;
  artist?: string;
  description?: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs?: number;
}): MediaAsset {
  const result = getDb()
    .prepare(
      `INSERT INTO media_assets (kind, title, artist, description, file_name, stored_name, mime_type, size_bytes, mtime_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.kind,
      params.title,
      params.kind === "audio" ? params.artist || "" : "",
      params.description || "",
      params.fileName,
      params.storedName,
      params.mimeType,
      params.sizeBytes,
      params.mtimeMs || 0,
    );
  return getMediaAsset(Number(result.lastInsertRowid))!;
}

export function getMediaAsset(id: number): MediaAsset | null {
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  const row = getDb().prepare("SELECT * FROM media_assets WHERE id = ?").get(id) as MediaRow | undefined;
  return row ? toAsset(row) : null;
}

function addFolderFilter(filters: string[], values: Array<string | number>, kind: MediaKind, folder: string, recursive: boolean) {
  const prefix = `${kind}/${folder ? `${folder}/` : ""}`;
  filters.push("stored_name LIKE ? ESCAPE '\\'");
  values.push(`${escapeLike(prefix)}%`);
  if (!recursive) {
    filters.push("instr(substr(stored_name, ?), '/') = 0");
    values.push(prefix.length + 1);
  }
}

export function normalizeMediaSortBy(value: string | undefined): MediaSortBy {
  return value === "name" || value === "size" ? value : "updated";
}

export function normalizeMediaSortOrder(value: string | undefined, sortBy: MediaSortBy): MediaSortOrder {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return sortBy === "name" ? "asc" : "desc";
}

function mediaAssetOrderBy(sortBy: MediaSortBy, sortOrder: MediaSortOrder): string {
  const direction = sortOrder === "asc" ? "ASC" : "DESC";
  if (sortBy === "name") {
    return `title COLLATE NOCASE ${direction}, file_name COLLATE NOCASE ${direction}, id ${direction}`;
  }
  if (sortBy === "size") {
    return `size_bytes ${direction}, title COLLATE NOCASE ASC, id ASC`;
  }
  return `updated_at ${direction}, id ${direction}`;
}

export function sortMediaFolders(folders: MediaFolder[], sortBy: MediaSortBy, sortOrder: MediaSortOrder): MediaFolder[] {
  const direction = sortOrder === "asc" ? 1 : -1;
  return [...folders].sort((left, right) => {
    let compared = 0;
    if (sortBy === "size") {
      compared = left.totalSizeBytes - right.totalSizeBytes;
    } else if (sortBy === "updated") {
      compared = left.mtimeMs - right.mtimeMs;
    } else {
      compared = left.name.localeCompare(right.name, "zh-CN", { numeric: true });
    }
    return compared ? compared * direction : left.name.localeCompare(right.name, "zh-CN", { numeric: true });
  });
}

export function listMediaAssets(params: {
  kind?: MediaKind;
  folder?: string;
  recursive?: boolean;
  query?: string;
  page?: number;
  pageSize?: number;
  sortBy?: MediaSortBy;
  sortOrder?: MediaSortOrder;
} = {}): { assets: MediaAsset[]; page: number; totalPages: number; totalAssets: number; query: string; folder: string } {
  const query = (params.query || "").trim().slice(0, 100);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 18), 1), 100);
  const sortBy = normalizeMediaSortBy(params.sortBy);
  const sortOrder = normalizeMediaSortOrder(params.sortOrder, sortBy);
  const folder = params.kind ? normalizeMediaFolder(params.folder || "") || "" : "";
  const filters: string[] = [];
  const values: Array<string | number> = [];
  if (params.kind) {
    filters.push("kind = ?");
    values.push(params.kind);
    addFolderFilter(filters, values, params.kind, folder, Boolean(params.recursive || query));
  }
  if (query) {
    filters.push("(title LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR stored_name LIKE ? ESCAPE '\\')");
    const escaped = `%${escapeLike(query)}%`;
    values.push(escaped, escaped, escaped, escaped, escaped);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const count = getDb().prepare(`SELECT COUNT(*) AS count FROM media_assets ${where}`).get(...values) as { count: number };
  const totalPages = Math.max(1, Math.ceil(count.count / pageSize));
  const page = Math.min(Math.max(Math.floor(params.page || 1), 1), totalPages);
  const rows = getDb()
    .prepare(`SELECT * FROM media_assets ${where} ORDER BY ${mediaAssetOrderBy(sortBy, sortOrder)} LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize) as MediaRow[];
  return { assets: rows.map(toAsset), page, totalPages, totalAssets: count.count, query, folder };
}

export function listMediaFolders(kind: MediaKind): MediaFolder[] {
  const paths = new Map(getMediaLibrarySyncState().folders[kind].map((item) => [item.path, item.mtimeMs]));
  const directCounts = new Map<string, number>();
  const aggregates = new Map<string, { totalSizeBytes: number; mtimeMs: number }>();
  const rows = getDb()
    .prepare("SELECT stored_name, size_bytes, mtime_ms FROM media_assets WHERE kind = ?")
    .all(kind) as Array<{ stored_name: string; size_bytes: number; mtime_ms: number }>;
  for (const row of rows) {
    const folder = mediaFolderFromStoredName(row.stored_name, kind);
    directCounts.set(folder, (directCounts.get(folder) || 0) + 1);
    const segments = folder ? folder.split("/") : [];
    for (let index = 1; index <= segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      paths.set(ancestor, Math.max(paths.get(ancestor) || 0, row.mtime_ms));
      const aggregate = aggregates.get(ancestor) || { totalSizeBytes: 0, mtimeMs: 0 };
      aggregate.totalSizeBytes += row.size_bytes;
      aggregate.mtimeMs = Math.max(aggregate.mtimeMs, row.mtime_ms);
      aggregates.set(ancestor, aggregate);
    }
  }

  return Array.from(paths, ([folderPath, mtimeMs]) => ({ folderPath, mtimeMs }))
    .sort((left, right) => left.folderPath.localeCompare(right.folderPath, "zh-CN", { numeric: true }))
    .map(({ folderPath, mtimeMs }) => ({
      path: folderPath,
      name: folderPath.split("/").at(-1) || folderPath,
      depth: folderPath.split("/").length - 1,
      directAssets: directCounts.get(folderPath) || 0,
      totalSizeBytes: aggregates.get(folderPath)?.totalSizeBytes || 0,
      mtimeMs: Math.max(mtimeMs, aggregates.get(folderPath)?.mtimeMs || 0),
    }));
}

export function listMediaFolderAssets(kind: MediaKind, folder: string, limit = 1_000): MediaAsset[] {
  const normalizedFolder = normalizeMediaFolder(folder) || "";
  const filters = ["kind = ?"];
  const values: Array<string | number> = [kind];
  addFolderFilter(filters, values, kind, normalizedFolder, false);
  const rows = getDb()
    .prepare(`SELECT * FROM media_assets WHERE ${filters.join(" AND ")} ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?`)
    .all(...values, Math.min(Math.max(Math.floor(limit), 1), 2_000)) as MediaRow[];
  return rows.map(toAsset);
}

export function listRelatedVideoAssets(currentId: number, count: number, mode: "next" | "random"): MediaAsset[] {
  const limit = Math.min(Math.max(Math.floor(count), 0), 20);
  if (!limit) {
    return [];
  }
  const rows = mode === "random"
    ? getDb().prepare("SELECT * FROM media_assets WHERE kind = 'video' AND id <> ? ORDER BY RANDOM() LIMIT ?").all(currentId, limit) as MediaRow[]
    : getDb()
      .prepare(
        `SELECT * FROM media_assets
         WHERE kind = 'video' AND id <> ?
         ORDER BY CASE WHEN id > ? THEN 0 ELSE 1 END, id ASC
         LIMIT ?`,
      )
      .all(currentId, currentId, limit) as MediaRow[];
  return rows.map(toAsset);
}

export function saveMediaDuration(id: number, durationSeconds: number): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }
  const info = getDb()
    .prepare("UPDATE media_assets SET duration_seconds = ? WHERE id = ?")
    .run(durationSeconds, id);
  return Number(info.changes) > 0;
}

export function listMediaAssetsNeedingDuration(limit = 100): MediaAsset[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM media_assets
       WHERE kind IN ('video', 'audio') AND (duration_seconds IS NULL OR duration_seconds <= 0)
       ORDER BY updated_at DESC, id ASC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(Math.floor(limit), 1), 1_000)) as MediaRow[];
  return rows.map(toAsset);
}

export function listVideoAssetsForPreparation(limit = 200): MediaAsset[] {
  const rows = getDb()
    .prepare("SELECT * FROM media_assets WHERE kind = 'video' ORDER BY updated_at DESC, id ASC LIMIT ?")
    .all(Math.min(Math.max(Math.floor(limit), 1), 1_000)) as MediaRow[];
  return rows.map(toAsset);
}

function mediaFolderAbsolutePath(kind: MediaKind, folder: string): string {
  const normalizedFolder = normalizeMediaFolder(folder);
  if (normalizedFolder === null) {
    throw new MediaFolderError("文件夹路径无效");
  }
  return mediaFilePath([kind, normalizedFolder].filter(Boolean).join("/"));
}

export function mediaFolderExists(kind: MediaKind, folder: string): boolean {
  ensureMediaDirectories();
  try {
    return fs.statSync(mediaFolderAbsolutePath(kind, folder)).isDirectory();
  } catch {
    return false;
  }
}

export function createMediaFolder(kind: MediaKind, parent: string, nameValue: string): string {
  ensureMediaDirectories();
  const normalizedParent = normalizeMediaFolder(parent);
  const name = normalizeFolderName(nameValue);
  if (normalizedParent === null || !name) {
    throw new MediaFolderError("文件夹名称无效");
  }
  const parentPath = mediaFolderAbsolutePath(kind, normalizedParent);
  if (!fs.statSync(parentPath).isDirectory()) {
    throw new MediaFolderError("上级文件夹不存在");
  }
  const folder = [normalizedParent, name].filter(Boolean).join("/");
  const targetPath = mediaFolderAbsolutePath(kind, folder);
  if (fs.existsSync(targetPath)) {
    throw new MediaFolderError("文件夹已存在");
  }
  fs.mkdirSync(targetPath);
  markMediaLibraryDirty();
  rememberMediaFolder(kind, folder);
  return folder;
}

export function renameMediaFolder(kind: MediaKind, folderValue: string, nameValue: string): string {
  const folder = normalizeMediaFolder(folderValue);
  const name = normalizeFolderName(nameValue);
  if (!folder || !name) {
    throw new MediaFolderError("文件夹名称无效");
  }
  const segments = folder.split("/");
  const parent = segments.slice(0, -1).join("/");
  const nextFolder = [parent, name].filter(Boolean).join("/");
  if (nextFolder === folder) {
    return folder;
  }
  const sourcePath = mediaFolderAbsolutePath(kind, folder);
  const targetPath = mediaFolderAbsolutePath(kind, nextFolder);
  if (!fs.existsSync(sourcePath)) {
    throw new MediaFolderError("文件夹不存在");
  }
  if (fs.existsSync(targetPath)) {
    throw new MediaFolderError("同名文件夹已存在");
  }

  const oldPrefix = `${kind}/${folder}/`;
  const nextPrefix = `${kind}/${nextFolder}/`;
  const rows = getDb().prepare("SELECT id, stored_name FROM media_assets WHERE stored_name LIKE ? ESCAPE '\\'").all(`${escapeLike(oldPrefix)}%`) as Array<{
    id: number;
    stored_name: string;
  }>;
  fs.renameSync(sourcePath, targetPath);
  const db = getDb();
  db.exec("BEGIN");
  try {
    const update = db.prepare("UPDATE media_assets SET stored_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    for (const row of rows) {
      update.run(`${nextPrefix}${row.stored_name.slice(oldPrefix.length)}`, row.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    fs.renameSync(targetPath, sourcePath);
    throw error;
  }
  markMediaLibraryDirty();
  renameRememberedMediaFolder(kind, folder, nextFolder);
  return nextFolder;
}

export function deleteMediaFolder(kind: MediaKind, folderValue: string): boolean {
  const folder = normalizeMediaFolder(folderValue);
  if (!folder) {
    throw new MediaFolderError("不能删除分类根目录");
  }
  const targetPath = mediaFolderAbsolutePath(kind, folder);
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  if (fs.readdirSync(targetPath).length) {
    throw new MediaFolderError("只能删除空文件夹");
  }
  fs.rmdirSync(targetPath);
  markMediaLibraryDirty();
  forgetMediaFolder(kind, folder);
  return true;
}

export function moveMediaAsset(id: number, folderValue: string): boolean {
  const asset = getMediaAsset(id);
  const folder = normalizeMediaFolder(folderValue);
  if (!asset || folder === null) {
    return false;
  }
  const targetDirectory = mediaFolderAbsolutePath(asset.kind, folder);
  if (!fs.existsSync(targetDirectory) || !fs.statSync(targetDirectory).isDirectory()) {
    throw new MediaFolderError("目标文件夹不存在");
  }
  const nextStoredName = mediaStoredName(asset.kind, folder, path.basename(asset.storedName));
  if (nextStoredName === asset.storedName) {
    return true;
  }
  const sourcePath = mediaFilePath(asset.storedName);
  const targetPath = mediaFilePath(nextStoredName);
  if (fs.existsSync(targetPath)) {
    throw new MediaFolderError("目标文件夹存在同名文件");
  }
  fs.renameSync(sourcePath, targetPath);
  try {
    getDb().prepare("UPDATE media_assets SET stored_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextStoredName, id);
  } catch (error) {
    fs.renameSync(targetPath, sourcePath);
    throw error;
  }
  markMediaLibraryDirty();
  return true;
}

export function updateMediaAsset(id: number, titleValue: string, artist: string, description: string, folderValue?: string): boolean {
  const asset = getMediaAsset(id);
  if (!asset) {
    return false;
  }
  const extension = path.extname(asset.fileName);
  const title = normalizeMediaTitle(titleValue, extension);
  const folder = normalizeMediaFolder(folderValue ?? asset.folder);
  if (!title) {
    throw new MediaFolderError("名称无效，不能包含文件路径字符");
  }
  if (folder === null || !mediaFolderExists(asset.kind, folder)) {
    throw new MediaFolderError("目标文件夹不存在");
  }

  const nextFileName = `${title}${extension}`;
  const nextStoredName = mediaStoredName(asset.kind, folder, nextFileName);
  const sourcePath = mediaFilePath(asset.storedName);
  const targetPath = mediaFilePath(nextStoredName);
  const samePathIgnoringCase = sourcePath.toLowerCase() === targetPath.toLowerCase();
  if (nextStoredName !== asset.storedName && fs.existsSync(targetPath) && !samePathIgnoringCase) {
    throw new MediaFolderError("目标文件夹存在同名文件");
  }

  let moved = false;
  if (nextStoredName !== asset.storedName) {
    if (samePathIgnoringCase) {
      const temporaryPath = `${sourcePath}.${crypto.randomBytes(6).toString("hex")}.rename`;
      fs.renameSync(sourcePath, temporaryPath);
      try {
        fs.renameSync(temporaryPath, targetPath);
      } catch (error) {
        fs.renameSync(temporaryPath, sourcePath);
        throw error;
      }
    } else {
      fs.renameSync(sourcePath, targetPath);
    }
    moved = true;
  }

  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = db
      .prepare(
        `UPDATE media_assets
         SET title = ?, artist = CASE WHEN kind = 'audio' THEN ? ELSE '' END, description = ?,
             file_name = ?, stored_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(title, artist, description, nextFileName, nextStoredName, id);
    db.prepare("UPDATE user_media_history SET title = ? WHERE media_id = ?").run(title, id);
    db.exec("COMMIT");
    markMediaLibraryDirty();
    return Number(result.changes) > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    if (moved) {
      fs.renameSync(targetPath, sourcePath);
    }
    throw error;
  }
}

export function incrementMediaPlayCount(id: number): boolean {
  return getDb().prepare("UPDATE media_assets SET play_count = play_count + 1 WHERE id = ?").run(id).changes > 0;
}

export function incrementMediaDownloadCount(id: number): boolean {
  return getDb().prepare("UPDATE media_assets SET download_count = download_count + 1 WHERE id = ?").run(id).changes > 0;
}

export function deleteMediaAssets(ids: number[]): { deleted: number; fileDeleteFailures: number } {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) {
    return { deleted: 0, fileDeleteFailures: 0 };
  }
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = getDb().prepare(`SELECT id, stored_name FROM media_assets WHERE id IN (${placeholders})`).all(...uniqueIds) as Array<{
    id: number;
    stored_name: string;
  }>;
  const deletedIds: number[] = [];
  let fileDeleteFailures = 0;
  for (const row of rows) {
    try {
      fs.rmSync(mediaFilePath(row.stored_name), { force: true });
      removeThumbnailFile(row.id);
      deletedIds.push(row.id);
    } catch {
      fileDeleteFailures += 1;
    }
  }
  if (!deletedIds.length) {
    return { deleted: 0, fileDeleteFailures };
  }
  const rowPlaceholders = deletedIds.map(() => "?").join(", ");
  const deleted = Number(getDb().prepare(`DELETE FROM media_assets WHERE id IN (${rowPlaceholders})`).run(...deletedIds).changes);
  markMediaLibraryDirty();
  return { deleted, fileDeleteFailures };
}

export type ByteRange = { start: number; end: number };

export function parseMediaByteRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) {
    return "invalid";
  }
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return "invalid";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
