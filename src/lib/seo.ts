import type { Metadata } from "next";

type SeoEnvironment = Readonly<Record<string, string | undefined>>;

export const NO_INDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
};

export function getSiteUrl(env: SeoEnvironment = process.env): string {
  const configured = env.SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.origin;
      }
    } catch {
      // Fall through to the local URL when SITE_URL is invalid.
    }
  }
  return `http://localhost:${env.PORT || "3000"}`;
}

export function absoluteSiteUrl(pathname: string, env: SeoEnvironment = process.env): string {
  return new URL(pathname, `${getSiteUrl(env)}/`).toString();
}

export function canonicalPagePath(pathname: string, page: number, pageParam = "page"): string {
  if (!Number.isInteger(page) || page <= 1) {
    return pathname;
  }
  const params = new URLSearchParams({ [pageParam]: String(page) });
  return `${pathname}?${params.toString()}`;
}

export type UmamiConfig = {
  websiteId: string;
  scriptUrl: string;
  recorderUrl: string | null;
};

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function enabledEnvironmentValue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}

export function getUmamiConfig(env: SeoEnvironment = process.env): UmamiConfig | null {
  const websiteId = env.UMAMI_WEBSITE_ID?.trim() || "";
  const rawScriptUrl = env.SCRIPT_URL?.trim() || "";
  if (!websiteId || websiteId.length > 200 || /[\u0000-\u001f\u007f]/.test(websiteId) || !rawScriptUrl) {
    return null;
  }

  const scriptUrl = safeHttpUrl(rawScriptUrl);
  if (!scriptUrl) {
    return null;
  }

  const rawRecorderUrl = env.UMAMI_RECORDER_URL?.trim() || "";
  let recorderUrl: URL | null = null;
  if (rawRecorderUrl) {
    recorderUrl = safeHttpUrl(rawRecorderUrl);
  } else if (enabledEnvironmentValue(env.UMAMI_RECORDER_ENABLED) && /script\.js$/i.test(scriptUrl.pathname)) {
    recorderUrl = new URL(scriptUrl);
    recorderUrl.pathname = recorderUrl.pathname.replace(/script\.js$/i, "recorder.js");
  }

  return {
    websiteId,
    scriptUrl: scriptUrl.toString(),
    recorderUrl: recorderUrl?.toString() || null,
  };
}
