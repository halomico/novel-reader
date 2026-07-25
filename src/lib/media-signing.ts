import crypto from "node:crypto";

export type SignedMediaPayload = {
  storedName: string;
  expiresAt: number;
  download: boolean;
  mimeType: string;
  fileName: string;
};

const MEDIA_PATH_PREFIX = "/media-file/";

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
    "v1",
    payload.storedName,
    String(payload.expiresAt),
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

export function getMediaNodeConfig(): { publicUrl: string; ttlSeconds: number } | null {
  const secret = signingSecret();
  const rawUrl = (process.env.MEDIA_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (secret.length < 32 || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null;
    }
    const numericTtl = Number(process.env.MEDIA_URL_TTL_SECONDS || 21_600);
    const ttlSeconds = Number.isFinite(numericTtl)
      ? Math.min(Math.max(Math.floor(numericTtl), 300), 86_400)
      : 21_600;
    return { publicUrl: url.toString().replace(/\/+$/, ""), ttlSeconds };
  } catch {
    return null;
  }
}

export function createSignedMediaUrl(input: {
  storedName: string;
  mimeType: string;
  fileName: string;
  download: boolean;
  now?: number;
}): string | null {
  const config = getMediaNodeConfig();
  if (!config) return null;
  const payload: SignedMediaPayload = {
    storedName: input.storedName,
    expiresAt: Math.floor((input.now ?? Date.now()) / 1_000) + config.ttlSeconds,
    download: input.download,
    mimeType: input.mimeType,
    fileName: input.fileName,
  };
  const params = new URLSearchParams({
    exp: String(payload.expiresAt),
    dl: payload.download ? "1" : "0",
    mt: encodeValue(payload.mimeType),
    fn: encodeValue(payload.fileName),
    sig: signature(payload, signingSecret()),
  });
  return `${config.publicUrl}${MEDIA_PATH_PREFIX}${encodedStoredName(payload.storedName)}?${params.toString()}`;
}

export function verifySignedMediaUrl(url: URL, now = Date.now()): SignedMediaPayload | null {
  const secret = signingSecret();
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
  const mimeType = decodeValue(url.searchParams.get("mt") || "", 160);
  const fileName = decodeValue(url.searchParams.get("fn") || "", 512);
  const suppliedSignature = url.searchParams.get("sig") || "";
  if (
    !Number.isInteger(expiresAt) ||
    expiresAt <= Math.floor(now / 1_000) ||
    expiresAt > Math.floor(now / 1_000) + 86_400 + 60 ||
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
