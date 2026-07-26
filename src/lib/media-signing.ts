import crypto from "node:crypto";
import { getRemoteMediaStorageConfig } from "./media-storage-config";

export type SignedMediaPayload = {
  storedName: string;
  expiresAt: number;
  mtimeMs: number;
  sizeBytes: number;
  download: boolean;
  mimeType: string;
  fileName: string;
};

const MEDIA_PATH_PREFIX = "/media-file/";
const THUMBNAIL_PATH_PREFIX = "/media-thumbnail/";
const THUMBNAIL_SIGNATURE_BUCKET_MAX_SECONDS = 60 * 60;

export type SignedMediaThumbnailPayload = {
  storedName: string;
  expiresAt: number;
  mtimeMs: number;
  sizeBytes: number;
  percent: number;
  publiclyAccessible: boolean;
};

function signingSecret(): string {
  return process.env.MEDIA_SIGNING_SECRET || "";
}

function encodeValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeValue(value: string, maxBytes: number): string | null {
  if (!value || value.length > maxBytes * 2) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length <= maxBytes ? decoded.toString("utf8") : null;
  } catch {
    return null;
  }
}

function payloadText(payload: SignedMediaPayload): string {
  return [
    "v2",
    payload.storedName,
    String(payload.expiresAt),
    String(payload.mtimeMs),
    String(payload.sizeBytes),
    payload.download ? "1" : "0",
    payload.mimeType,
    payload.fileName,
  ].join("\n");
}

function signature(payload: SignedMediaPayload, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadText(payload)).digest("base64url");
}

function encodedStoredName(storedName: string): string {
  return storedName.split("/").map(encodeURIComponent).join("/");
}

export function createSignedMediaUrl(input: {
  storedName: string;
  mimeType: string;
  fileName: string;
  mtimeMs: number;
  sizeBytes: number;
  download: boolean;
  now?: number;
}): string {
  const config = getRemoteMediaStorageConfig();
  const payload: SignedMediaPayload = {
    storedName: input.storedName,
    expiresAt: Math.floor((input.now ?? Date.now()) / 1_000) + config.ttlSeconds,
    mtimeMs: Math.floor(input.mtimeMs),
    sizeBytes: Math.floor(input.sizeBytes),
    download: input.download,
    mimeType: input.mimeType,
    fileName: input.fileName,
  };
  const params = new URLSearchParams({
    exp: String(payload.expiresAt),
    v: String(payload.mtimeMs),
    s: String(payload.sizeBytes),
    dl: payload.download ? "1" : "0",
    mt: encodeValue(payload.mimeType),
    fn: encodeValue(payload.fileName),
    sig: signature(payload, signingSecret()),
  });
  return `${config.publicUrl}${MEDIA_PATH_PREFIX}${encodedStoredName(payload.storedName)}?${params.toString()}`;
}

export function verifySignedMediaUrl(url: URL, now = Date.now(), secret = signingSecret()): SignedMediaPayload | null {
  if (secret.length < 32 || !url.pathname.startsWith(MEDIA_PATH_PREFIX)) return null;
  let storedName: string;
  try {
    storedName = url.pathname
      .slice(MEDIA_PATH_PREFIX.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
  } catch {
    return null;
  }
  if (!storedName || storedName.includes("\\") || storedName.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  const expiresAt = Number(url.searchParams.get("exp"));
  const mtimeMs = Number(url.searchParams.get("v"));
  const sizeBytes = Number(url.searchParams.get("s"));
  const mimeType = decodeValue(url.searchParams.get("mt") || "", 160);
  const fileName = decodeValue(url.searchParams.get("fn") || "", 512);
  const suppliedSignature = url.searchParams.get("sig") || "";
  if (
    !Number.isInteger(expiresAt) ||
    expiresAt <= Math.floor(now / 1_000) ||
    expiresAt > Math.floor(now / 1_000) + 86_400 + 60 ||
    !Number.isInteger(mtimeMs) ||
    mtimeMs <= 0 ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    !mimeType ||
    !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType) ||
    !fileName ||
    suppliedSignature.length !== 43
  ) {
    return null;
  }
  const payload: SignedMediaPayload = {
    storedName,
    expiresAt,
    mtimeMs,
    sizeBytes,
    download: url.searchParams.get("dl") === "1",
    mimeType,
    fileName,
  };
  const expected = signature(payload, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(suppliedSignature), Buffer.from(expected)) ? payload : null;
  } catch {
    return null;
  }
}

function thumbnailPayloadText(payload: SignedMediaThumbnailPayload): string {
  return [
    "thumbnail-v2",
    payload.storedName,
    String(payload.expiresAt),
    String(payload.mtimeMs),
    String(payload.sizeBytes),
    String(payload.percent),
    payload.publiclyAccessible ? "1" : "0",
  ].join("\n");
}

function thumbnailSignature(payload: SignedMediaThumbnailPayload, secret: string): string {
  return crypto.createHmac("sha256", secret).update(thumbnailPayloadText(payload)).digest("base64url");
}

export function createSignedMediaThumbnailUrl(input: {
  storedName: string;
  mtimeMs: number;
  sizeBytes: number;
  percent: number;
  publiclyAccessible: boolean;
  now?: number;
}): string {
  const config = getRemoteMediaStorageConfig();
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1_000);
  const bucketSeconds = Math.min(config.ttlSeconds, THUMBNAIL_SIGNATURE_BUCKET_MAX_SECONDS);
  const payload: SignedMediaThumbnailPayload = {
    storedName: input.storedName,
    expiresAt: Math.floor(nowSeconds / bucketSeconds) * bucketSeconds + config.ttlSeconds + bucketSeconds,
    mtimeMs: Math.floor(input.mtimeMs),
    sizeBytes: Math.floor(input.sizeBytes),
    percent: Math.min(Math.max(Math.floor(input.percent), 1), 99),
    publiclyAccessible: input.publiclyAccessible,
  };
  const params = new URLSearchParams({
    exp: String(payload.expiresAt),
    v: String(payload.mtimeMs),
    s: String(payload.sizeBytes),
    p: String(payload.percent),
    public: payload.publiclyAccessible ? "1" : "0",
    sig: thumbnailSignature(payload, config.signingSecret),
  });
  return `${config.publicUrl}${THUMBNAIL_PATH_PREFIX}${encodedStoredName(payload.storedName)}?${params.toString()}`;
}

export function verifySignedMediaThumbnailUrl(
  url: URL,
  now = Date.now(),
  secret = signingSecret(),
): SignedMediaThumbnailPayload | null {
  if (secret.length < 32 || !url.pathname.startsWith(THUMBNAIL_PATH_PREFIX)) return null;
  let storedName: string;
  try {
    storedName = url.pathname
      .slice(THUMBNAIL_PATH_PREFIX.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
  } catch {
    return null;
  }
  const expiresAt = Number(url.searchParams.get("exp"));
  const mtimeMs = Number(url.searchParams.get("v"));
  const sizeBytes = Number(url.searchParams.get("s"));
  const percent = Number(url.searchParams.get("p"));
  const suppliedSignature = url.searchParams.get("sig") || "";
  if (
    !storedName ||
    storedName.includes("\\") ||
    storedName.split("/").some((part) => !part || part === "." || part === "..") ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= Math.floor(now / 1_000) ||
    expiresAt > Math.floor(now / 1_000) + 86_400 + THUMBNAIL_SIGNATURE_BUCKET_MAX_SECONDS + 60 ||
    !Number.isInteger(mtimeMs) ||
    mtimeMs <= 0 ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    !Number.isInteger(percent) ||
    percent < 1 ||
    percent > 99 ||
    suppliedSignature.length !== 43
  ) {
    return null;
  }
  const payload: SignedMediaThumbnailPayload = {
    storedName,
    expiresAt,
    mtimeMs,
    sizeBytes,
    percent,
    publiclyAccessible: url.searchParams.get("public") === "1",
  };
  const expected = thumbnailSignature(payload, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(suppliedSignature), Buffer.from(expected)) ? payload : null;
  } catch {
    return null;
  }
}
