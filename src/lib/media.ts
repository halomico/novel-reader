import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMediaDir, isAudioLibraryEnabled, isFileLibraryEnabled, isVideoLibraryEnabled } from "./config";
import { getDb } from "./db";

export type MediaKind = "video" | "audio" | "file";

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

type MediaGlobal = typeof globalThis & {
  mediaLibrarySyncState?: { directory: string; syncedAt: number };
};

export class MediaFolderError extends Error {}

const MEDIA_SYNC_INTERVAL_MS = 2_000;
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

export function createStoredMediaName(extension: string): string {
  return `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension}`;
}

function markMediaLibraryDirty() {
  delete (globalThis as MediaGlobal).mediaLibrarySyncState;
}

function ensureMediaDirectories() {
  fs.mkdirSync(getMediaDir(), { recursive: true });
  fs.mkdirSync(path.join(getMediaDir(), ".uploads"), { recursive: true });
  fs.mkdirSync(path.join(getMediaDir(), ".thumbnails"), { recursive: true });
  for (const kind of MEDIA_KINDS) {
    fs.mkdirSync(path.join(getMediaDir(), kind), { recursive: true });
  }
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

function scanMediaFiles(): Map<string, ScannedMediaFile> {
  const files = new Map<string, ScannedMediaFile>();
  const visit = (kind: MediaKind, directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(kind, absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const normalizedFile = normalizeMediaFile({ kind, fileName: entry.name, mimeType: "" });
      if (!normalizedFile) {
        continue;
      }
      const stat = fs.statSync(absolutePath);
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
    visit(kind, path.join(getMediaDir(), kind));
  }
  return files;
}

function removeThumbnailFile(id: number) {
  fs.rmSync(path.join(getMediaDir(), ".thumbnails", `${id}.jpg`), { force: true });
}

export function syncMediaLibrary(options: { force?: boolean } = {}): MediaSyncResult {
  const directory = path.resolve(getMediaDir());
  const now = Date.now();
  const state = (globalThis as MediaGlobal).mediaLibrarySyncState;
  if (!options.force && state?.directory === directory && now - state.syncedAt < MEDIA_SYNC_INTERVAL_MS) {
    return { added: 0, updated: 0, removed: 0 };
  }

  ensureMediaDirectories();
  migrateFlatMediaAssets();
  const scanned = scanMediaFiles();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM media_assets").all() as MediaRow[];
  const existing = new Map(rows.map((row) => [row.stored_name, row]));
  const removedRows = rows.filter((row) => !scanned.has(row.stored_name));
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
       SET file_name = ?, mime_type = ?, size_bytes = ?, mtime_ms = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );
    for (const file of scanned.values()) {
      const row = existing.get(file.storedName);
      if (!row) {
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
      } else if (
        row.file_name !== file.fileName ||
        row.mime_type !== file.mimeType ||
        row.size_bytes !== file.sizeBytes ||
        row.mtime_ms !== file.mtimeMs
      ) {
        update.run(file.fileName, file.mimeType, file.sizeBytes, file.mtimeMs, row.id);
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
  (globalThis as MediaGlobal).mediaLibrarySyncState = { directory, syncedAt: now };
  return { added, updated, removed: removedRows.length };
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
  syncMediaLibrary();
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

export function listMediaAssets(params: {
  kind?: MediaKind;
  folder?: string;
  recursive?: boolean;
  query?: string;
  page?: number;
  pageSize?: number;
} = {}): { assets: MediaAsset[]; page: number; totalPages: number; totalAssets: number; query: string; folder: string } {
  syncMediaLibrary();
  const query = (params.query || "").trim().slice(0, 100);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 18), 1), 100);
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
    .prepare(`SELECT * FROM media_assets ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize) as MediaRow[];
  return { assets: rows.map(toAsset), page, totalPages, totalAssets: count.count, query, folder };
}

export function listMediaFolders(kind: MediaKind): MediaFolder[] {
  syncMediaLibrary();
  const root = path.join(getMediaDir(), kind);
  const paths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      paths.push(toPosixPath(path.relative(root, absolutePath)));
      visit(absolutePath);
    }
  };
  visit(root);

  const directCounts = new Map<string, number>();
  const rows = getDb().prepare("SELECT stored_name FROM media_assets WHERE kind = ?").all(kind) as Array<{ stored_name: string }>;
  for (const row of rows) {
    const folder = mediaFolderFromStoredName(row.stored_name, kind);
    directCounts.set(folder, (directCounts.get(folder) || 0) + 1);
  }

  return paths
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }))
    .map((folderPath) => ({
      path: folderPath,
      name: folderPath.split("/").at(-1) || folderPath,
      depth: folderPath.split("/").length - 1,
      directAssets: directCounts.get(folderPath) || 0,
    }));
}

export function listMediaFolderAssets(kind: MediaKind, folder: string, limit = 1_000): MediaAsset[] {
  syncMediaLibrary();
  const normalizedFolder = normalizeMediaFolder(folder) || "";
  const filters = ["kind = ?"];
  const values: Array<string | number> = [kind];
  addFolderFilter(filters, values, kind, normalizedFolder, false);
  const rows = getDb()
    .prepare(`SELECT * FROM media_assets WHERE ${filters.join(" AND ")} ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?`)
    .all(...values, Math.min(Math.max(Math.floor(limit), 1), 2_000)) as MediaRow[];
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
  return folder;
}

export function renameMediaFolder(kind: MediaKind, folderValue: string, nameValue: string): string {
  syncMediaLibrary({ force: true });
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

export function updateMediaAsset(id: number, title: string, artist: string, description: string): boolean {
  const result = getDb()
    .prepare("UPDATE media_assets SET title = ?, artist = CASE WHEN kind = 'audio' THEN ? ELSE '' END, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(title, artist, description, id);
  return result.changes > 0;
}

export function incrementMediaPlayCount(id: number): boolean {
  return getDb().prepare("UPDATE media_assets SET play_count = play_count + 1 WHERE id = ?").run(id).changes > 0;
}

export function incrementMediaDownloadCount(id: number): boolean {
  return getDb().prepare("UPDATE media_assets SET download_count = download_count + 1 WHERE id = ?").run(id).changes > 0;
}

export function deleteMediaAssets(ids: number[]): { deleted: number; fileDeleteFailures: number } {
  syncMediaLibrary();
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
