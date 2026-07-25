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

export const DEFAULT_HOME_PORTAL_ORDER: HomePortalCardKey[] = [...HOME_PORTAL_CARD_KEYS];

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
