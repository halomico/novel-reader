import {
  type MediaNodeKind,
  type MediaNodeManifestFile,
  type MediaNodeManifestFolder,
  type MediaNodeManifestPage,
  type MediaNodeUploadReceipt,
  type MediaNodeUploadRequest,
  type MediaNodeUploadStart,
} from "./media-node-protocol";
import { getRemoteMediaNodeConfig } from "./media-storage-config";

type NodeResponse<T> = T & { ok?: boolean; message?: string };

export class MediaNodeClientError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

async function controlRequest<T>(
  nodeId: string,
  pathname: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<NodeResponse<T>> {
  const config = getRemoteMediaNodeConfig(nodeId);
  let response: Response;
  try {
    response = await fetch(`${config.controlUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.controlSecret}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MediaNodeClientError("无法连接媒体节点");
  }
  let body: NodeResponse<T>;
  try {
    body = await response.json() as NodeResponse<T>;
  } catch {
    throw new MediaNodeClientError("媒体节点返回了无效响应");
  }
  if (!response.ok || body.ok === false) {
    throw new MediaNodeClientError(body.message || "媒体节点操作失败", response.status);
  }
  return body;
}

export async function startRemoteMediaUpload(
  nodeId: string,
  request: Omit<MediaNodeUploadRequest, "allowedOrigin">,
  allowedOrigin: string,
): Promise<MediaNodeUploadStart & { uploadUrl: string }> {
  const config = getRemoteMediaNodeConfig(nodeId);
  const result = await controlRequest<MediaNodeUploadStart>(
    nodeId,
    "/control/uploads",
    {
      method: "POST",
      body: JSON.stringify({ ...request, allowedOrigin }),
    },
  );
  return {
    uploadId: result.uploadId,
    uploadToken: result.uploadToken,
    chunkBytes: result.chunkBytes,
    uploadUrl: `${config.publicUrl}/media-upload/${result.uploadId}`,
  };
}

export async function finishRemoteMediaUpload(nodeId: string, uploadId: string): Promise<MediaNodeUploadReceipt> {
  const result = await controlRequest<{ receipt: MediaNodeUploadReceipt }>(
    nodeId,
    `/control/uploads/${encodeURIComponent(uploadId)}/finish`,
    { method: "POST" },
    10 * 60_000,
  );
  return result.receipt;
}

export async function cancelRemoteMediaUpload(nodeId: string, uploadId: string): Promise<boolean> {
  const result = await controlRequest<{ cancelled: boolean }>(
    nodeId,
    `/control/uploads/${encodeURIComponent(uploadId)}`,
    { method: "DELETE" },
  );
  return Boolean(result.cancelled);
}

export async function readRemoteMediaManifest(nodeId: string, refresh = false): Promise<{
  files: MediaNodeManifestFile[];
  folders: MediaNodeManifestFolder[];
}> {
  const files: MediaNodeManifestFile[] = [];
  const folders: MediaNodeManifestFolder[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < 200; page += 1) {
    const params = new URLSearchParams({ limit: "2000" });
    if (cursor) params.set("cursor", cursor);
    if (refresh && !cursor) params.set("refresh", "1");
    const result = await controlRequest<MediaNodeManifestPage>(
      nodeId,
      `/control/manifest?${params.toString()}`,
      {},
      120_000,
    );
    files.push(...result.files);
    folders.push(...result.folders);
    if (!result.nextCursor) return { files, folders };
    if (seenCursors.has(result.nextCursor)) {
      throw new MediaNodeClientError("媒体节点清单游标重复");
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new MediaNodeClientError("媒体节点清单超过安全分页上限");
}

export async function createRemoteMediaFolder(nodeId: string, kind: MediaNodeKind, folder: string): Promise<string> {
  const result = await controlRequest<{ folder: string }>(nodeId, "/control/folders", {
    method: "POST",
    body: JSON.stringify({ kind, folder }),
  });
  return result.folder;
}

export async function renameRemoteMediaFolder(
  nodeId: string,
  kind: MediaNodeKind,
  folder: string,
  nextFolder: string,
): Promise<string> {
  const result = await controlRequest<{ folder: string }>(nodeId, "/control/folders", {
    method: "PATCH",
    body: JSON.stringify({ kind, folder, nextFolder }),
  });
  return result.folder;
}

export async function deleteRemoteMediaFolder(nodeId: string, kind: MediaNodeKind, folder: string): Promise<boolean> {
  const result = await controlRequest<{ deleted: boolean }>(nodeId, "/control/folders", {
    method: "DELETE",
    body: JSON.stringify({ kind, folder }),
  });
  return Boolean(result.deleted);
}

export async function moveRemoteMediaAsset(
  nodeId: string,
  sourceStoredName: string,
  targetStoredName: string,
): Promise<boolean> {
  const result = await controlRequest<{ moved: boolean }>(nodeId, "/control/assets/move", {
    method: "POST",
    body: JSON.stringify({ sourceStoredName, targetStoredName }),
  });
  return Boolean(result.moved);
}

export async function deleteRemoteMediaAssets(nodeId: string, storedNames: string[]): Promise<{
  deletedStoredNames: string[];
  failedStoredNames: string[];
}> {
  const result = await controlRequest<{ deletedStoredNames: string[]; failedStoredNames: string[] }>(nodeId, "/control/assets/delete", {
    method: "POST",
    body: JSON.stringify({ storedNames }),
  });
  return {
    deletedStoredNames: Array.isArray(result.deletedStoredNames) ? result.deletedStoredNames : [],
    failedStoredNames: Array.isArray(result.failedStoredNames) ? result.failedStoredNames : [],
  };
}

export async function probeRemoteMediaDuration(asset: {
  storageNodeId: string;
  storedName: string;
  mtimeMs: number;
  sizeBytes: number;
}): Promise<number> {
  const result = await controlRequest<{ durationSeconds: number }>(asset.storageNodeId, "/control/probe", {
    method: "POST",
    body: JSON.stringify({
      storedName: asset.storedName,
      mtimeMs: asset.mtimeMs,
      sizeBytes: asset.sizeBytes,
    }),
  }, 30_000);
  const duration = Number(result.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new MediaNodeClientError("媒体节点未返回有效时长");
  }
  return duration;
}

export async function prepareRemoteMediaThumbnail(asset: {
  storageNodeId: string;
  storedName: string;
  mtimeMs: number;
  sizeBytes: number;
  durationSeconds?: number | null;
}, percent: number): Promise<boolean> {
  const result = await controlRequest<{ ready: boolean }>(asset.storageNodeId, "/control/thumbnails/prepare", {
    method: "POST",
    body: JSON.stringify({
      storedName: asset.storedName,
      mtimeMs: asset.mtimeMs,
      sizeBytes: asset.sizeBytes,
      durationSeconds: asset.durationSeconds,
      percent: Math.min(Math.max(Math.floor(percent), 1), 99),
    }),
  }, 120_000);
  return Boolean(result.ready);
}

export async function clearRemoteMediaThumbnails(nodeId: string): Promise<number> {
  const result = await controlRequest<{ removed: number }>(nodeId, "/control/thumbnails", { method: "DELETE" });
  return Number(result.removed) || 0;
}

export async function writeRemoteMediaCover(nodeId: string, key: string, buffer: Buffer): Promise<void> {
  await controlRequest<Record<string, never>>(
    nodeId,
    `/control/covers/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        "Content-Length": String(buffer.length),
        "Content-Type": "image/jpeg",
      },
      body: new Uint8Array(buffer),
    },
    30_000,
  );
}

export async function deleteRemoteMediaCover(nodeId: string, key: string): Promise<boolean> {
  const result = await controlRequest<{ deleted: boolean }>(
    nodeId,
    `/control/covers/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  return Boolean(result.deleted);
}
