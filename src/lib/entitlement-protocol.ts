export const ENTITLEMENT_TARGET_TYPES = [
  "novel",
  "novel_source",
  "video",
  "video_category",
  "video_tag",
  "audio",
  "audio_folder",
  "file",
  "file_folder",
] as const;

export type EntitlementTargetType = (typeof ENTITLEMENT_TARGET_TYPES)[number];
export type EntitlementRight = "read" | "play" | "view" | "download";

export type EntitlementDefinition = {
  targetType: EntitlementTargetType;
  targetId: string;
  rights: EntitlementRight[];
  durationSeconds: number | null;
};

export type EntitlementTargetOption = {
  id: string;
  label: string;
  meta: string;
};

export const ENTITLEMENT_TARGET_RIGHTS: Record<EntitlementTargetType, EntitlementRight[]> = {
  novel: ["read"],
  novel_source: ["read"],
  video: ["play", "download"],
  video_category: ["play", "download"],
  video_tag: ["play", "download"],
  audio: ["play", "download"],
  audio_folder: ["play", "download"],
  file: ["view", "download"],
  file_folder: ["view", "download"],
};

export function isEntitlementTargetType(value: unknown): value is EntitlementTargetType {
  return typeof value === "string" && (ENTITLEMENT_TARGET_TYPES as readonly string[]).includes(value);
}

function uniqueRights(targetType: EntitlementTargetType, value: unknown): EntitlementRight[] {
  const allowed = new Set(ENTITLEMENT_TARGET_RIGHTS[targetType]);
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.filter(
    (right): right is EntitlementRight => typeof right === "string" && allowed.has(right as EntitlementRight),
  )));
}

export function parseEntitlementDefinition(value: unknown): EntitlementDefinition | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const targetTypeValue = source.targetType ?? source.resourceType;
  if (!isEntitlementTargetType(targetTypeValue)) return null;
  const targetId = String(source.targetId ?? source.resourceId ?? "").trim().slice(0, 240);
  if (!targetId) return null;
  const rights = uniqueRights(targetTypeValue, source.rights);
  if (!rights.length) return null;
  const rawDuration = Number(source.durationSeconds);
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.min(Math.floor(rawDuration), 10 * 365 * 24 * 60 * 60)
    : null;
  return { targetType: targetTypeValue, targetId, rights, durationSeconds };
}

export function encodeEntitlementDefinition(definition: EntitlementDefinition): string {
  return JSON.stringify({ version: 1, ...definition });
}

export function decodeEntitlementDefinition(content: string): EntitlementDefinition | null {
  try {
    return parseEntitlementDefinition(JSON.parse(content));
  } catch {
    return null;
  }
}
