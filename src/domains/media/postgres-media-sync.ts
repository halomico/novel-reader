import fs from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { getMediaDir, isMediaLibraryDiscoverEnabled } from "@/lib/config";
import { deleteMediaCustomCover } from "@/lib/media-cover";
import { readRemoteMediaManifest } from "@/lib/media-node-client";
import {
  isRemoteMediaStorage,
  listRemoteMediaNodes,
  remoteMediaRegistryFingerprint,
  resolveRemoteMediaNodeForAsset,
} from "@/lib/media-storage-config";
import { isIgnoredMediaStorageEntry } from "@/lib/media-scan-filter";
import { removePlaybackHlsVersions, resolvePlaybackHlsFile } from "@/lib/video-hls";
import { type MediaKind } from "./media-model";
import {
  availableLocalMediaStoredName,
  ensureLocalMediaDirectories,
  mediaFilePath,
  normalizeMediaFile,
} from "./media-storage-model";
import { indexedPostgresMediaStoredNames } from "./postgres-media-admin";

export type PostgresMediaSyncResult = { added: number; updated: number; removed: number };

type ScannedMediaFile = {
  kind: MediaKind;
  storageNodeId: string | null;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
};

type ScannedMediaFolder = { kind: MediaKind; storageNodeId: string; path: string; mtimeMs: number };
type ScannedMediaLibrary = {
  files: Map<string, ScannedMediaFile>;
  folders: ScannedMediaFolder[];
  completedNodeIds: Set<string>;
};

type SyncMediaRow = QueryResultRow & {
  id: string | number;
  kind: MediaKind;
  storage_node_id: string | null;
  title: string;
  file_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: string | number;
  mtime_ms: string | number;
  playback_format: string;
  playback_version: string;
  playback_manifest_path: string | null;
  custom_cover_key: string | null;
};

type SyncState = { key: string; syncedAt: number; running?: Promise<PostgresMediaSyncResult> };
type SyncGlobal = typeof globalThis & { postgresMediaSyncState?: SyncState };

const MEDIA_KINDS: readonly MediaKind[] = ["video", "audio", "file"];
const MEDIA_SYNC_INTERVAL_MS = 30 * 60 * 1_000;

function safeInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function storageKey(storageNodeId: string | null, storedName: string): string {
  return `${storageNodeId || "local"}\u0000${storedName}`;
}

function syncState(): SyncState {
  const key = isRemoteMediaStorage()
    ? `remote:${remoteMediaRegistryFingerprint()}`
    : `local:${path.resolve(getMediaDir())}`;
  const globalState = globalThis as SyncGlobal;
  if (!globalState.postgresMediaSyncState || globalState.postgresMediaSyncState.key !== key) {
    globalState.postgresMediaSyncState = { key, syncedAt: 0 };
  }
  return globalState.postgresMediaSyncState;
}

async function scanPostgresMediaStorage(refreshRemote: boolean): Promise<ScannedMediaLibrary> {
  const files = new Map<string, ScannedMediaFile>();
  const folders: ScannedMediaFolder[] = [];
  const completedNodeIds = new Set<string>();
  if (isRemoteMediaStorage()) {
    const failures: unknown[] = [];
    for (const node of listRemoteMediaNodes()) {
      try {
        const manifest = await readRemoteMediaManifest(node.id, refreshRemote);
        completedNodeIds.add(node.id);
        for (const file of manifest.files) {
          files.set(storageKey(node.id, file.storedName), { ...file, storageNodeId: node.id });
        }
        for (const folder of manifest.folders) {
          folders.push({ ...folder, storageNodeId: node.id });
        }
      } catch (error) {
        failures.push(error);
        console.warn(`[media] failed to read manifest from node ${node.id}`, error);
      }
    }
    if (!completedNodeIds.size && failures.length) throw failures[0];
    return { files, folders, completedNodeIds };
  }

  ensureLocalMediaDirectories();
  const visit = async (kind: MediaKind, directory: string, relativeFolder = ""): Promise<void> => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || isIgnoredMediaStorageEntry(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const folderPath = [relativeFolder, entry.name].filter(Boolean).join("/");
        const stat = await fs.promises.stat(absolutePath);
        folders.push({ kind, storageNodeId: "", path: folderPath, mtimeMs: Math.floor(stat.mtimeMs) });
        await visit(kind, absolutePath, folderPath);
      } else if (entry.isFile()) {
        const normalized = normalizeMediaFile({ kind, fileName: entry.name, mimeType: "" });
        if (!normalized) continue;
        const stat = await fs.promises.stat(absolutePath);
        const storedName = path.relative(getMediaDir(), absolutePath).replace(/\\/gu, "/");
        files.set(storageKey(null, storedName), {
          kind,
          storageNodeId: null,
          fileName: normalized.fileName,
          storedName,
          mimeType: normalized.mimeType,
          sizeBytes: stat.size,
          mtimeMs: Math.floor(stat.mtimeMs),
        });
      }
    }
  };
  for (const kind of MEDIA_KINDS) await visit(kind, path.join(getMediaDir(), kind));
  return { files, folders, completedNodeIds };
}

async function normalizeLegacyLocalPaths(executor: SqlExecutor): Promise<void> {
  if (isRemoteMediaStorage()) return;
  const result = await executor.query<SyncMediaRow>({
    text: "SELECT * FROM media_assets WHERE stored_name NOT LIKE kind || '/%'",
  });
  for (const row of result.rows) {
    const sourcePath = mediaFilePath(row.stored_name);
    const sourceExists = fs.existsSync(sourcePath);
    const indexed = await indexedPostgresMediaStoredNames(executor, row.kind, "", path.basename(row.stored_name));
    indexed.delete(row.stored_name);
    const canonicalStoredName = `${row.kind}/${path.basename(row.stored_name)}`;
    const canonicalPath = mediaFilePath(canonicalStoredName);
    const nextStoredName = !sourceExists && fs.existsSync(canonicalPath)
      ? canonicalStoredName
      : availableLocalMediaStoredName(row.kind, "", path.basename(row.stored_name), indexed, row.stored_name);
    const targetPath = mediaFilePath(nextStoredName);
    if (!sourceExists && !fs.existsSync(targetPath)) continue;
    if (sourceExists) {
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.rename(sourcePath, targetPath);
    }
    try {
      const updated = await executor.query({
        text: `UPDATE media_assets SET stored_name = $2, file_name = $3, updated_at = clock_timestamp()
          WHERE id = $1 AND stored_name = $4`,
        values: [safeInteger(row.id, "media id"), nextStoredName, path.basename(nextStoredName), row.stored_name],
      });
      if (updated.rowCount !== 1) throw new Error("Legacy media path changed concurrently");
    } catch (error) {
      if (sourceExists) await fs.promises.rename(targetPath, sourcePath).catch(() => undefined);
      throw error;
    }
  }
}

function removeLocalDerivedFiles(id: number, kind: MediaKind): void {
  const directory = path.join(getMediaDir(), ".thumbnails");
  if (fs.existsSync(directory)) {
    for (const fileName of fs.readdirSync(directory)) {
      if (fileName === `${id}.jpg` || fileName.startsWith(`${id}-`)) {
        fs.rmSync(path.join(directory, fileName), { force: true });
      }
    }
  }
  if (kind === "video") removePlaybackHlsVersions(getMediaDir(), id);
}

function identity(item: ScannedMediaFile | SyncMediaRow): string {
  const size = "sizeBytes" in item ? item.sizeBytes : safeInteger(item.size_bytes, "media size");
  const mtime = "mtimeMs" in item ? item.mtimeMs : safeInteger(item.mtime_ms, "media mtime");
  const fileName = "fileName" in item ? item.fileName : item.file_name;
  return `${item.kind}:${size}:${mtime}:${path.extname(fileName).toLowerCase()}`;
}

function currentStorageNode(row: SyncMediaRow, remote: boolean): string | null {
  return remote ? row.storage_node_id || resolveRemoteMediaNodeForAsset(null, row.kind).id : null;
}

async function reconcilePostgresMediaLibrary(refreshRemote: boolean): Promise<PostgresMediaSyncResult> {
  const startedAt = Date.now();
  if (!isMediaLibraryDiscoverEnabled()) return { added: 0, updated: 0, removed: 0 };
  const executor = database("jobs");
  await normalizeLegacyLocalPaths(executor);
  const scannedLibrary = await scanPostgresMediaStorage(refreshRemote);
  const scanned = scannedLibrary.files;
  const queried = await executor.query<SyncMediaRow>({ text: "SELECT * FROM media_assets" });
  const rows = queried.rows;
  const remote = isRemoteMediaStorage();
  const existing = new Map<string, SyncMediaRow>();
  for (const row of rows) existing.set(storageKey(currentStorageNode(row, remote), row.stored_name), row);

  const missingRows = rows.filter((row) => {
    const nodeId = currentStorageNode(row, remote);
    if (remote && (!nodeId || !scannedLibrary.completedNodeIds.has(nodeId))) return false;
    if (scanned.has(storageKey(nodeId, row.stored_name))) return false;
    if (!remote) {
      const manifest = row.playback_manifest_path
        ? resolvePlaybackHlsFile(getMediaDir(), row.playback_manifest_path, "index.m3u8")
        : null;
      if (row.kind === "video" && row.playback_format === "hls" && row.playback_version && manifest && fs.existsSync(manifest)) {
        return false;
      }
      try {
        if (fs.existsSync(mediaFilePath(row.stored_name))) return false;
      } catch {
        return true;
      }
    }
    return true;
  });
  const newFiles = [...scanned.values()].filter((file) => !existing.has(storageKey(file.storageNodeId, file.storedName)));
  const missingByIdentity = new Map<string, SyncMediaRow[]>();
  const newByIdentity = new Map<string, ScannedMediaFile[]>();
  for (const row of missingRows) missingByIdentity.set(identity(row), [...(missingByIdentity.get(identity(row)) || []), row]);
  for (const file of newFiles) newByIdentity.set(identity(file), [...(newByIdentity.get(identity(file)) || []), file]);
  const renamed: Array<{ row: SyncMediaRow; file: ScannedMediaFile }> = [];
  for (const [key, oldRows] of missingByIdentity) {
    const nextFiles = newByIdentity.get(key) || [];
    if (oldRows.length === 1 && nextFiles.length === 1 && safeInteger(oldRows[0].mtime_ms, "media mtime") > 0) {
      renamed.push({ row: oldRows[0], file: nextFiles[0] });
    }
  }
  const renamedIds = new Set(renamed.map(({ row }) => safeInteger(row.id, "media id")));
  const renamedKeys = new Set(renamed.map(({ file }) => storageKey(file.storageNodeId, file.storedName)));
  const removed = missingRows.filter((row) => !renamedIds.has(safeInteger(row.id, "media id")));
  const claimedNames = new Set(rows.map((row) => row.stored_name));
  const inserts: ScannedMediaFile[] = [];
  const updates: Array<ScannedMediaFile & { id: number; title: string; sourceChanged: boolean }> = [];
  for (const file of scanned.values()) {
    const key = storageKey(file.storageNodeId, file.storedName);
    const row = existing.get(key);
    if (!row && !renamedKeys.has(key)) {
      if (claimedNames.has(file.storedName)) {
        console.warn(`[media] skipped duplicate logical path on node ${file.storageNodeId || "local"}: ${file.storedName}`);
        continue;
      }
      inserts.push(file);
      claimedNames.add(file.storedName);
      continue;
    }
    if (!row) continue;
    const sourceChanged = safeInteger(row.size_bytes, "media size") !== file.sizeBytes ||
      safeInteger(row.mtime_ms, "media mtime") !== file.mtimeMs;
    if (
      row.storage_node_id !== file.storageNodeId || row.file_name !== file.fileName ||
      row.mime_type !== file.mimeType || sourceChanged
    ) {
      updates.push({
        ...file,
        id: safeInteger(row.id, "media id"),
        title: row.file_name === file.fileName ? row.title : path.basename(file.fileName, path.extname(file.fileName)),
        sourceChanged,
      });
    }
  }

  const result = await withTransaction(async (tx) => {
    let added = 0;
    let updated = 0;
    if (renamed.length) {
      const payload = renamed.map(({ row, file }) => ({
        id: safeInteger(row.id, "media id"),
        title: path.basename(file.fileName, path.extname(file.fileName)),
        fileName: file.fileName,
        storedName: file.storedName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        storageNodeId: file.storageNodeId,
      }));
      const changed = await tx.query({
        text: `WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
              id bigint, title text, "fileName" text, "storedName" text, "mimeType" text,
              "sizeBytes" bigint, "mtimeMs" bigint, "storageNodeId" text)
          ) UPDATE media_assets asset SET storage_node_id = input."storageNodeId", title = input.title,
            file_name = input."fileName", stored_name = input."storedName", mime_type = input."mimeType",
            size_bytes = input."sizeBytes", mtime_ms = input."mtimeMs", updated_at = clock_timestamp()
          FROM input WHERE asset.id = input.id`,
        values: [JSON.stringify(payload)],
      });
      await tx.query({
        text: `WITH input AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(id bigint, title text))
          UPDATE user_media_history history SET title = input.title FROM input WHERE history.media_id = input.id`,
        values: [JSON.stringify(payload)],
      });
      updated += changed.rowCount ?? 0;
    }
    if (inserts.length) {
      const payload = inserts.map((file) => ({
        ...file,
        title: path.basename(file.fileName, path.extname(file.fileName)),
      }));
      const inserted = await tx.query({
        text: `WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
              kind text, "storageNodeId" text, title text, "fileName" text, "storedName" text,
              "mimeType" text, "sizeBytes" bigint, "mtimeMs" bigint)
          ) INSERT INTO media_assets (
            kind, storage_node_id, title, artist, description, file_name, stored_name, mime_type, size_bytes, mtime_ms)
          SELECT kind, "storageNodeId", title, '', '', "fileName", "storedName", "mimeType", "sizeBytes", "mtimeMs"
          FROM input ON CONFLICT (stored_name) DO NOTHING`,
        values: [JSON.stringify(payload)],
      });
      added += inserted.rowCount ?? 0;
    }
    if (updates.length) {
      const changed = await tx.query({
        text: `WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
              id bigint, title text, "fileName" text, "mimeType" text, "sizeBytes" bigint,
              "mtimeMs" bigint, "storageNodeId" text, "sourceChanged" boolean)
          ) UPDATE media_assets asset SET storage_node_id = input."storageNodeId", title = input.title,
            file_name = input."fileName", mime_type = input."mimeType", size_bytes = input."sizeBytes",
            mtime_ms = input."mtimeMs",
            duration_seconds = CASE WHEN input."sourceChanged" THEN NULL ELSE asset.duration_seconds END,
            thumbnail_version = CASE WHEN input."sourceChanged" THEN 0 ELSE asset.thumbnail_version END,
            playback_status = CASE WHEN input."sourceChanged" THEN
              CASE WHEN asset.playback_format = 'hls' AND asset.playback_manifest_path IS NOT NULL AND asset.playback_version <> ''
                THEN 'ready' ELSE 'none' END ELSE asset.playback_status END,
            playback_error = CASE WHEN input."sourceChanged" THEN '' ELSE asset.playback_error END,
            content_updated_at = CASE WHEN input."sourceChanged" THEN clock_timestamp() ELSE asset.content_updated_at END,
            updated_at = clock_timestamp()
          FROM input WHERE asset.id = input.id`,
        values: [JSON.stringify(updates)],
      });
      await tx.query({
        text: `WITH input AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(id bigint, title text))
          UPDATE user_media_history history SET title = input.title FROM input WHERE history.media_id = input.id`,
        values: [JSON.stringify(updates)],
      });
      const changedVideos = updates.filter((item) => item.kind === "video" && item.sourceChanged);
      if (changedVideos.length) {
        await tx.query({
          text: `WITH input AS (
              SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(id bigint, "mtimeMs" bigint, "sizeBytes" bigint)
            ) DELETE FROM media_playback_jobs job USING input
            WHERE job.media_id = input.id AND job.source_version <> input."mtimeMs"::text || '-' || input."sizeBytes"::text`,
          values: [JSON.stringify(changedVideos)],
        });
      }
      updated += changed.rowCount ?? 0;
    }
    const removedIds = removed.map((row) => safeInteger(row.id, "media id"));
    if (removedIds.length) {
      await tx.query({ text: "DELETE FROM media_assets WHERE id = ANY($1::bigint[])", values: [removedIds] });
    }
    if (remote) {
      for (const nodeId of scannedLibrary.completedNodeIds) {
        await tx.query({ text: "DELETE FROM media_folders WHERE storage_node_id = $1", values: [nodeId] });
      }
    } else {
      await tx.query({ text: "DELETE FROM media_folders WHERE storage_node_id = ''" });
    }
    if (scannedLibrary.folders.length) {
      await tx.query({
        text: `WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(kind text, "storageNodeId" text, path text, "mtimeMs" bigint)
          ) INSERT INTO media_folders (kind, storage_node_id, path, mtime_ms)
          SELECT kind, "storageNodeId", path, "mtimeMs" FROM input
          ON CONFLICT (kind, storage_node_id, path) DO UPDATE
          SET mtime_ms = EXCLUDED.mtime_ms, updated_at = clock_timestamp()`,
        values: [JSON.stringify(scannedLibrary.folders)],
      });
    }
    return { added, updated, removed: removedIds.length };
  }, { role: "jobs", lockTimeoutMs: 5_000 });

  for (const row of removed) {
    const id = safeInteger(row.id, "media id");
    if (!remote) removeLocalDerivedFiles(id, row.kind);
    if (row.custom_cover_key) {
      await deleteMediaCustomCover(
        { kind: row.kind, storageNodeId: row.storage_node_id },
        row.custom_cover_key,
      ).catch((error) => console.warn(`[media] failed to delete orphaned custom cover for asset ${id}`, error));
    }
  }
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= 1_000 || result.added || result.updated || result.removed) {
    console.info(`[media] PostgreSQL library sync ${elapsedMs}ms: +${result.added} ~${result.updated} -${result.removed}`);
  }
  return result;
}

export function syncPostgresMediaLibrary(options: { force?: boolean } = {}): Promise<PostgresMediaSyncResult> {
  const state = syncState();
  const now = Date.now();
  if (state.running) return state.running;
  if (!options.force && now - state.syncedAt < MEDIA_SYNC_INTERVAL_MS) {
    return Promise.resolve({ added: 0, updated: 0, removed: 0 });
  }
  const job = reconcilePostgresMediaLibrary(Boolean(options.force));
  state.running = job;
  void job.then(() => {
    state.syncedAt = Date.now();
  }).finally(() => {
    if (state.running === job) delete state.running;
  }).catch(() => undefined);
  return job;
}
