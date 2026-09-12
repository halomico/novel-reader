/**
 * Prefetching a dynamic page runs the whole page on the server (`router.prefetch` asks
 * for a full render), so speculative fetches must stay a small, bounded addition to real
 * navigations however a visitor moves the pointer. One budget per tab decides them all:
 *
 * - a URL is prefetched at most once per `PREFETCH_TTL_MS`, about as long as the router
 *   keeps the result;
 * - hover, focus and idle prefetches wait for intent to settle, and only
 *   `PREFETCH_WINDOW_LIMIT` of them may start in any `PREFETCH_WINDOW_MS`, so sweeping the
 *   pointer down a list costs a few renders rather than one per row;
 * - a mouse or pen press is exempt from that window: its click follows within about a
 *   hundred milliseconds and fetches the page anyway, so it adds no request of its own;
 * - once the server answers any fetch with 429 or 503, prefetching stops for
 *   `PREFETCH_BUSY_PAUSE_MS`, so a busy server only sees real navigations.
 */
export const PREFETCH_HOVER_DELAY_MS = 180;
export const PREFETCH_TTL_MS = 60_000;
export const PREFETCH_WINDOW_MS = 10_000;
export const PREFETCH_WINDOW_LIMIT = 4;
export const PREFETCH_BUSY_PAUSE_MS = 60_000;

export type PrefetchIntent = "hover" | "idle" | "press";

export type PrefetchBudget = {
  /** Claims a prefetch of `href`; false means skip it. */
  tryAcquire(href: string, intent: PrefetchIntent): boolean;
  /** Stops every prefetch for `durationMs`. */
  pause(durationMs?: number): void;
};

const MAX_REMEMBERED_URLS = 256;

export function createPrefetchBudget(now: () => number = Date.now): PrefetchBudget {
  const fetchedAt = new Map<string, number>();
  const windowStarts: number[] = [];
  let pausedUntil = 0;

  return {
    tryAcquire(href, intent) {
      const time = now();
      if (time < pausedUntil) return false;
      const previous = fetchedAt.get(href);
      if (previous !== undefined && time - previous < PREFETCH_TTL_MS) return false;
      while (windowStarts.length && time - windowStarts[0] >= PREFETCH_WINDOW_MS) windowStarts.shift();
      if (intent !== "press") {
        if (windowStarts.length >= PREFETCH_WINDOW_LIMIT) return false;
        windowStarts.push(time);
      }
      fetchedAt.delete(href);
      fetchedAt.set(href, time);
      if (fetchedAt.size > MAX_REMEMBERED_URLS) fetchedAt.delete(fetchedAt.keys().next().value!);
      return true;
    },
    pause(durationMs = PREFETCH_BUSY_PAUSE_MS) {
      pausedUntil = Math.max(pausedUntil, now() + durationMs);
    },
  };
}

/** A status the server uses when it refuses work because it is overloaded. */
export function isServerBusyStatus(status: number | undefined): boolean {
  return status === 429 || status === 503;
}

const tab = globalThis as typeof globalThis & { novelReaderPrefetchBudget?: PrefetchBudget };

/**
 * The budget shared by every link in this tab. The first call also starts watching
 * resource timings, whose `responseStatus` (Chromium) shows a server shedding load.
 */
export function tabPrefetchBudget(): PrefetchBudget {
  if (tab.novelReaderPrefetchBudget) return tab.novelReaderPrefetchBudget;
  const budget = createPrefetchBudget();
  tab.novelReaderPrefetchBudget = budget;
  if (typeof PerformanceObserver === "function") {
    try {
      new PerformanceObserver((list) => {
        const busy = list.getEntries().some((entry) => (
          isServerBusyStatus((entry as PerformanceEntry & { responseStatus?: number }).responseStatus)
        ));
        if (busy) budget.pause();
      }).observe({ type: "resource" });
    } catch {
      // Without resource timing the pause never starts; the window still bounds prefetching.
    }
  }
  return budget;
}
