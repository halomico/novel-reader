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
import { createMediaAsset, getMediaAssetByStoredName, type MediaAsset } from "./media";
import { isRemoteMediaStorage } from "./media-storage-config";

export type MediaStorageUploadStart = {
  uploadId: string;
  chunkBytes: number;
  uploadUrl: string;
  uploadToken?: string;
};

type UploadInput = Parameters<typeof prepareMediaUpload>[0];

function remoteError(error: unknown): never {
  if (error instanceof MediaNodeClientError) {
    throw new MediaUploadError(error.message, error.status >= 400 && error.status < 600 ? error.status : 502);
  }
  throw error;
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
    return await startRemoteMediaUpload(prepared, allowedOrigin);
  } catch (error) {
    remoteError(error);
  }
}

export async function finishMediaStorageUpload(uploadId: string): Promise<MediaAsset> {
  if (!isRemoteMediaStorage()) {
    return await finishMediaUpload(uploadId);
  }
  try {
    const receipt = await finishRemoteMediaUpload(uploadId);
    const existing = getMediaAssetByStoredName(receipt.storedName);
    if (existing) return existing;
    return createMediaAsset({
      kind: receipt.kind,
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
    return await cancelRemoteMediaUpload(uploadId);
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
