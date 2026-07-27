import {
  cancelRemoteMediaUpload,
  finishRemoteMediaUpload,
  MediaNodeClientError,
  startRemoteMediaUpload,
} from "./media-node-client";
import {
  cancelMediaUpload,
  finishMediaUpload,
  getMediaUploadOffset,
  MediaUploadError,
  prepareMediaUpload,
  startMediaUpload,
} from "./media-upload";
import {
  availableIndexedMediaStoredName,
  createMediaAsset,
  getMediaAssetByStoredName,
  MediaFolderError,
  mediaFolderFromStoredName,
  type MediaAsset,
} from "./media";
import {
  getRemoteMediaNodeForKind,
  getRemoteMediaStorageConfig,
  isRemoteMediaStorage,
} from "./media-storage-config";

export type MediaStorageUploadStart = {
  uploadId: string;
  chunkBytes: number;
  uploadUrl: string;
  uploadToken?: string;
};

type UploadInput = Parameters<typeof prepareMediaUpload>[0];
const REMOTE_UPLOAD_HANDLE_PATTERN = /^([a-z0-9][a-z0-9_-]{0,31})~([a-f0-9]{32})$/;

function remoteError(error: unknown): never {
  if (error instanceof MediaNodeClientError) {
    throw new MediaUploadError(error.message, error.status >= 400 && error.status < 600 ? error.status : 502);
  }
  if (error instanceof MediaFolderError) {
    throw new MediaUploadError(error.message, 409);
  }
  throw error;
}

function remoteUploadHandle(nodeId: string, uploadId: string): string {
  return `${nodeId}~${uploadId}`;
}

function parseRemoteUploadHandle(value: string): { nodeId: string; uploadId: string } {
  const matched = REMOTE_UPLOAD_HANDLE_PATTERN.exec(value);
  if (matched) {
    return { nodeId: matched[1], uploadId: matched[2] };
  }
  return {
    nodeId: getRemoteMediaStorageConfig().id,
    uploadId: value,
  };
}

export async function startMediaStorageUpload(
  params: UploadInput,
  allowedOrigin: string,
): Promise<MediaStorageUploadStart> {
  if (!isRemoteMediaStorage()) {
    const result = startMediaUpload(params);
    return {
      ...result,
      uploadUrl: `/admin/media/upload?action=chunk&uploadId=${result.uploadId}`,
    };
  }
  const prepared = prepareMediaUpload(params, { requireLocalFolder: false });
  try {
    const node = getRemoteMediaNodeForKind(prepared.kind);
    const requestedFileName = prepared.storedName.split("/").at(-1) || prepared.storedName;
    const storedName = availableIndexedMediaStoredName(
      prepared.kind,
      mediaFolderFromStoredName(prepared.storedName, prepared.kind),
      requestedFileName,
    );
    const started = await startRemoteMediaUpload(
      node.id,
      { ...prepared, storedName },
      allowedOrigin,
    );
    return {
      ...started,
      uploadId: remoteUploadHandle(node.id, started.uploadId),
    };
  } catch (error) {
    remoteError(error);
  }
}

export async function finishMediaStorageUpload(uploadId: string): Promise<MediaAsset> {
  if (!isRemoteMediaStorage()) {
    return await finishMediaUpload(uploadId);
  }
  try {
    const remoteUpload = parseRemoteUploadHandle(uploadId);
    const receipt = await finishRemoteMediaUpload(remoteUpload.nodeId, remoteUpload.uploadId);
    const existing = getMediaAssetByStoredName(receipt.storedName, remoteUpload.nodeId);
    if (existing) return existing;
    return createMediaAsset({
      kind: receipt.kind,
      storageNodeId: remoteUpload.nodeId,
      categoryId: receipt.categoryId,
      title: receipt.title,
      artist: receipt.artist,
      description: receipt.description,
      fileName: receipt.fileName,
      storedName: receipt.storedName,
      mimeType: receipt.mimeType,
      sizeBytes: receipt.sizeBytes,
      mtimeMs: receipt.mtimeMs,
      durationSeconds: receipt.durationSeconds,
    });
  } catch (error) {
    remoteError(error);
  }
}

export async function cancelMediaStorageUpload(uploadId: string): Promise<boolean> {
  if (!isRemoteMediaStorage()) {
    return await cancelMediaUpload(uploadId);
  }
  try {
    const remoteUpload = parseRemoteUploadHandle(uploadId);
    return await cancelRemoteMediaUpload(remoteUpload.nodeId, remoteUpload.uploadId);
  } catch (error) {
    remoteError(error);
  }
}

export function getLocalMediaStorageUploadOffset(uploadId: string): Promise<number> {
  if (isRemoteMediaStorage()) {
    throw new MediaUploadError("远程上传进度由媒体节点提供", 400);
  }
  return getMediaUploadOffset(uploadId);
}
