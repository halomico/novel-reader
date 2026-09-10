import { createHash } from "node:crypto";

export type ContentVersion = `sha256:${string}`;

const CONTENT_VERSION_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export function contentVersionForText(text: string): ContentVersion {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function isContentVersion(value: unknown): value is ContentVersion {
  return typeof value === "string" && CONTENT_VERSION_PATTERN.test(value);
}
