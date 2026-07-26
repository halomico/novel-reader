export type MediaNodeKind = "video" | "audio" | "file";

export const MEDIA_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const MEDIA_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const MEDIA_UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type MediaNodeUploadRequest = {
  kind: MediaNodeKind;
  categoryId: number | null;
  title: string;
  artist: string;
  description: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  allowedOrigin: string;
};

export type MediaNodeUploadStart = {
  uploadId: string;
  uploadToken: string;
  chunkBytes: number;
};

export type MediaNodeUploadReceipt = {
  uploadId: string;
  kind: MediaNodeKind;
  categoryId: number | null;
  title: string;
  artist: string;
  description: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  durationSeconds: number | null;
};

export type MediaNodeManifestFile = {
  kind: MediaNodeKind;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
};

export type MediaNodeManifestFolder = {
  kind: MediaNodeKind;
  path: string;
  mtimeMs: number;
};

export type MediaNodeManifestPage = {
  files: MediaNodeManifestFile[];
  folders: MediaNodeManifestFolder[];
  nextCursor: string | null;
};
