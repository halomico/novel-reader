export const HOME_PORTAL_CARD_KEYS = [
  "announcement",
  "novels",
  "tags",
  "video",
  "audio",
  "file",
  "random",
] as const;

export type HomePortalCardKey = (typeof HOME_PORTAL_CARD_KEYS)[number];
export type HomePortalContentCardKey = Exclude<HomePortalCardKey, "random">;
export type HomePortalAccessMode = "off" | "member" | "preview" | "public";

export const DEFAULT_HOME_PORTAL_ORDER: HomePortalCardKey[] = [...HOME_PORTAL_CARD_KEYS];
export const HOME_PORTAL_CONTENT_CARD_KEYS = HOME_PORTAL_CARD_KEYS.filter(
  (key): key is HomePortalContentCardKey => key !== "random",
);

export function normalizeHomePortalOrder(value: unknown): HomePortalCardKey[] {
  const requested = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const validKeys = new Set<string>(HOME_PORTAL_CARD_KEYS);
  const order = requested.filter(
    (key, index): key is HomePortalCardKey =>
      typeof key === "string" && validKeys.has(key) && requested.indexOf(key) === index,
  );
  return [...order, ...HOME_PORTAL_CARD_KEYS.filter((key) => !order.includes(key))];
}

export function normalizePublicDisplayHomeCards(value: unknown): HomePortalContentCardKey[] {
  if (!Array.isArray(value)) return [];
  const validKeys = new Set<string>(HOME_PORTAL_CONTENT_CARD_KEYS);
  return value.filter(
    (key, index): key is HomePortalContentCardKey =>
      typeof key === "string" && validKeys.has(key) && value.indexOf(key) === index,
  );
}

export function resolveHomePortalAccessMode(
  enabled: boolean,
  guestAccessible: boolean,
  publicDisplay: boolean,
): HomePortalAccessMode {
  if (!enabled) return "off";
  if (guestAccessible) return "public";
  return publicDisplay ? "preview" : "member";
}

export function isHomePortalCardVisible(mode: HomePortalAccessMode, authenticated: boolean): boolean {
  return mode === "public" || mode === "preview" || (authenticated && mode === "member");
}
