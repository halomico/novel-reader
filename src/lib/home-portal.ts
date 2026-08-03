export const HOME_PORTAL_CARD_KEYS = [
  "announcement",
  "novels",
  "tags",
  "video",
  "audio",
  "file",
  "recent",
] as const;

export type HomePortalCardKey = (typeof HOME_PORTAL_CARD_KEYS)[number];
export type HomePortalContentCardKey = Exclude<HomePortalCardKey, "recent">;
export type HomePortalAccessMode = "off" | "member" | "browse" | "public";
export type HomePortalAccessModes = Record<HomePortalContentCardKey, HomePortalAccessMode>;

export const DEFAULT_HOME_PORTAL_ORDER: HomePortalCardKey[] = [...HOME_PORTAL_CARD_KEYS];
export const HOME_PORTAL_CONTENT_CARD_KEYS = HOME_PORTAL_CARD_KEYS.filter(
  (key): key is HomePortalContentCardKey => key !== "recent",
);

export const DEFAULT_HOME_PORTAL_ACCESS_MODES: HomePortalAccessModes = {
  announcement: "public",
  novels: "member",
  tags: "member",
  video: "member",
  audio: "member",
  file: "member",
};

export function normalizeHomePortalOrder(value: unknown): HomePortalCardKey[] {
  const requested = (Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : []).map((key) => key === "random" ? "recent" : key);
  const validKeys = new Set<string>(HOME_PORTAL_CARD_KEYS);
  const order = requested.filter(
    (key, index): key is HomePortalCardKey =>
      typeof key === "string" && validKeys.has(key) && requested.indexOf(key) === index,
  );
  return [...order, ...HOME_PORTAL_CARD_KEYS.filter((key) => !order.includes(key))];
}

export function normalizeHomePortalAccessMode(value: unknown, fallback: HomePortalAccessMode): HomePortalAccessMode {
  if (value === "preview") return "browse";
  return value === "off" || value === "member" || value === "browse" || value === "public"
    ? value
    : fallback;
}

export function normalizeHomePortalAccessModes(
  value: unknown,
  fallback: HomePortalAccessModes = DEFAULT_HOME_PORTAL_ACCESS_MODES,
): HomePortalAccessModes {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(HOME_PORTAL_CONTENT_CARD_KEYS.map((key) => [
    key,
    normalizeHomePortalAccessMode(source[key], fallback[key]),
  ])) as HomePortalAccessModes;
}

export function resolveHomePortalAccessMode(
  enabled: boolean,
  guestAccessible: boolean,
  publicDisplay: boolean,
): HomePortalAccessMode {
  if (!enabled) return "off";
  if (guestAccessible) return "public";
  return publicDisplay ? "browse" : "member";
}

export function isHomePortalCardVisible(mode: HomePortalAccessMode, authenticated: boolean): boolean {
  return isHomePortalEntryVisible(mode, authenticated);
}

export function isHomePortalEntryVisible(mode: HomePortalAccessMode, authenticated: boolean): boolean {
  if (mode === "off") return false;
  return authenticated || mode === "browse" || mode === "public";
}

export function canBrowseHomePortal(mode: HomePortalAccessMode, authenticated: boolean): boolean {
  return mode === "public" || (authenticated && (mode === "browse" || mode === "member"));
}

export function canConsumeHomePortal(mode: HomePortalAccessMode, authenticated: boolean): boolean {
  return mode === "public" || (authenticated && (mode === "browse" || mode === "member"));
}
