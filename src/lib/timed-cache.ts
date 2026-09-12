/**
 * A small in-memory cache whose entries expire after `ttlMs` and whose oldest entries are
 * dropped beyond `maxEntries`. Client components keep one per tab for data that is cheap
 * to reuse for a short while and expensive to fetch again on every mount.
 */
export type TimedCache<Value> = {
  get(key: string): Value | undefined;
  set(key: string, value: Value): void;
};

export function createTimedCache<Value>({
  ttlMs,
  maxEntries,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}): TimedCache<Value> {
  const entries = new Map<string, { value: Value; storedAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.storedAt >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, storedAt: now() });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
  };
}
