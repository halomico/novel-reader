import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSiteSettingsPath, readSiteSettings, type SiteIconMimeType } from "./site-settings";

export const MAX_SITE_ICON_BYTES = 15 * 1024 * 1024;

type SiteIconFormat = {
  extension: "png" | "jpg" | "webp" | "ico";
  mimeType: Exclude<SiteIconMimeType, "">;
};

export type SiteIconAsset = {
  bytes: Buffer;
  mimeType: Exclude<SiteIconMimeType, "">;
};

function siteIconStorageDir(): string {
  return path.join(path.dirname(getSiteSettingsPath()), "site-assets");
}

function siteIconFilePath(fileName: string): string | null {
  const safeName = path.basename(fileName);
  if (safeName !== fileName || !/^site-icon-[a-zA-Z0-9-]+\.(?:png|jpg|webp|ico)$/.test(safeName)) {
    return null;
  }
  return path.join(siteIconStorageDir(), safeName);
}

export function detectSiteIconFormat(buffer: Buffer): SiteIconFormat | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return { extension: "ico", mimeType: "image/x-icon" };
  }
  return null;
}

export function writeSiteIconFile(buffer: Buffer): { fileName: string; mimeType: Exclude<SiteIconMimeType, "">; updatedAt: string } {
  if (buffer.length > MAX_SITE_ICON_BYTES) {
    throw new Error("icon-too-large");
  }
  const format = detectSiteIconFormat(buffer);
  if (!format) {
    throw new Error("unsupported-icon");
  }

  const updatedAt = new Date().toISOString();
  const fileName = `site-icon-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${format.extension}`;
  const storageDir = siteIconStorageDir();
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(path.join(storageDir, fileName), buffer);
  return { fileName, mimeType: format.mimeType, updatedAt };
}

export function removeSiteIconFile(fileName: string): boolean {
  const filePath = siteIconFilePath(fileName);
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function readSiteIconAsset(): SiteIconAsset | null {
  const settings = readSiteSettings();
  const filePath = siteIconFilePath(settings.siteIconFileName);
  if (!filePath || !settings.siteIconMimeType || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return {
      bytes: fs.readFileSync(filePath),
      mimeType: settings.siteIconMimeType,
    };
  } catch {
    return null;
  }
}

export function getSiteIconHref(): string | undefined {
  const settings = readSiteSettings();
  const filePath = siteIconFilePath(settings.siteIconFileName);
  if (!filePath || !settings.siteIconMimeType || !fs.existsSync(filePath)) {
    return undefined;
  }
  const version = settings.siteIconUpdatedAt || settings.siteIconFileName;
  return `/api/site-icon?v=${encodeURIComponent(version)}`;
}
