export type MediaStorageMode = "local" | "remote";

type MediaDeliveryConfig = {
  publicUrl: string;
  signingSecret: string;
  ttlSeconds: number;
};

export type RemoteMediaStorageConfig = MediaDeliveryConfig & {
  controlUrl: string;
  controlSecret: string;
};

export class MediaStorageConfigurationError extends Error {}

function cleanOrigin(value: string | undefined): string | null {
  const raw = (value || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
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
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function mediaUrlTtlSeconds(env: NodeJS.ProcessEnv): number {
  const numeric = Number(env.MEDIA_URL_TTL_SECONDS || 21_600);
  return Number.isFinite(numeric)
    ? Math.min(Math.max(Math.floor(numeric), 300), 86_400)
    : 21_600;
}

export function getMediaStorageMode(env: NodeJS.ProcessEnv = process.env): MediaStorageMode {
  const value = (env.MEDIA_STORAGE_MODE || "local").trim().toLowerCase();
  if (value === "local" || value === "remote") {
    return value;
  }
  throw new MediaStorageConfigurationError("MEDIA_STORAGE_MODE 只能是 local 或 remote");
}

export function isRemoteMediaStorage(env: NodeJS.ProcessEnv = process.env): boolean {
  return getMediaStorageMode(env) === "remote";
}

function getMediaDeliveryConfig(env: NodeJS.ProcessEnv): MediaDeliveryConfig | null {
  const publicUrl = cleanOrigin(env.MEDIA_PUBLIC_URL);
  const signingSecret = env.MEDIA_SIGNING_SECRET || "";
  if (!publicUrl || signingSecret.length < 32) {
    return null;
  }
  return {
    publicUrl,
    signingSecret,
    ttlSeconds: mediaUrlTtlSeconds(env),
  };
}

export function getRemoteMediaStorageConfig(env: NodeJS.ProcessEnv = process.env): RemoteMediaStorageConfig {
  if (getMediaStorageMode(env) !== "remote") {
    throw new MediaStorageConfigurationError("远程媒体存储未启用");
  }
  const delivery = getMediaDeliveryConfig(env);
  const controlUrl = cleanOrigin(env.MEDIA_CONTROL_URL);
  const controlSecret = env.MEDIA_CONTROL_SECRET || "";
  if (!delivery) {
    throw new MediaStorageConfigurationError("远程媒体存储需要合法的 MEDIA_PUBLIC_URL 和至少 32 字符的 MEDIA_SIGNING_SECRET");
  }
  if (!controlUrl || controlSecret.length < 32) {
    throw new MediaStorageConfigurationError("远程媒体存储需要合法的 MEDIA_CONTROL_URL 和至少 32 字符的 MEDIA_CONTROL_SECRET");
  }
  return {
    ...delivery,
    controlUrl,
    controlSecret,
  };
}
