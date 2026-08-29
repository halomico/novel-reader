export const CONTEXT_NAVIGATION_STORAGE_KEY = "novel-context-navigation:v1";

const CONTEXT_NAVIGATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ContextNavigationRecord = {
  source: string;
  destination: string;
  returnTo: string;
  runtimeId: string;
  createdAt: number;
};

type ContextNavigationInput = {
  sourceHref: string;
  destinationHref: string;
  returnHref?: string;
  origin: string;
  runtimeId: string;
  now?: number;
};

type ContextBackInput = {
  record: ContextNavigationRecord | null;
  currentHref: string;
  expectedReturnHref: string;
  origin: string;
  runtimeId: string;
  historyLength: number;
  now?: number;
};

export function normalizeContextHref(href: string, origin: string): string | null {
  try {
    const originUrl = new URL(origin);
    const url = new URL(href, originUrl);
    if (url.origin !== originUrl.origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function normalizeComparableReturnHref(href: string, origin: string): string | null {
  const normalized = normalizeContextHref(href, origin);
  if (!normalized) return null;
  const url = new URL(normalized, origin);
  if (url.searchParams.get("page") === "1") url.searchParams.delete("page");
  if (url.searchParams.get("folderPage") === "1") url.searchParams.delete("folderPage");
  url.searchParams.sort();
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export function createContextNavigationRecord({
  sourceHref,
  destinationHref,
  returnHref = sourceHref,
  origin,
  runtimeId,
  now = Date.now(),
}: ContextNavigationInput): ContextNavigationRecord | null {
  const source = normalizeContextHref(sourceHref, origin);
  const destination = normalizeContextHref(destinationHref, origin);
  const returnTo = normalizeContextHref(returnHref, origin);
  if (!source || !destination || !returnTo || !runtimeId || source === destination) return null;
  return { source, destination, returnTo, runtimeId, createdAt: now };
}

function matchesBookRedirect(destination: string, current: string, origin: string): boolean {
  const destinationUrl = new URL(destination, origin);
  const currentUrl = new URL(current, origin);
  const match = /^(\/zh-hant)?\/books\/(\d+)$/.exec(destinationUrl.pathname);
  if (!match) return false;
  const localePrefix = match[1] || "";
  return currentUrl.pathname.startsWith(`${localePrefix}/books/${match[2]}/chapters/`) &&
    currentUrl.search === destinationUrl.search;
}

export function canUseContextHistoryBack({
  record,
  currentHref,
  expectedReturnHref,
  origin,
  runtimeId,
  historyLength,
  now = Date.now(),
}: ContextBackInput): boolean {
  if (!record || historyLength <= 1 || now - record.createdAt > CONTEXT_NAVIGATION_MAX_AGE_MS) return false;
  const current = normalizeContextHref(currentHref, origin);
  if (!current || (record.destination !== current && !matchesBookRedirect(record.destination, current, origin))) return false;
  const expectedReturn = normalizeComparableReturnHref(expectedReturnHref, origin);
  const recordedReturn = normalizeComparableReturnHref(record.returnTo, origin);
  return record.runtimeId === runtimeId && Boolean(expectedReturn && recordedReturn === expectedReturn);
}

let browserRuntimeId = "";

function getBrowserRuntimeId(): string {
  if (!browserRuntimeId) {
    browserRuntimeId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  return browserRuntimeId;
}

export function rememberContextNavigation(destinationHref: string, returnHref?: string): void {
  try {
    const record = createContextNavigationRecord({
      sourceHref: window.location.href,
      destinationHref,
      returnHref,
      origin: window.location.origin,
      runtimeId: getBrowserRuntimeId(),
    });
    if (record) window.sessionStorage.setItem(CONTEXT_NAVIGATION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Navigation remains available when session storage is unavailable.
  }
}

export function shouldUseContextHistoryBack(expectedReturnHref: string): boolean {
  let record: ContextNavigationRecord | null = null;
  try {
    const raw = window.sessionStorage.getItem(CONTEXT_NAVIGATION_STORAGE_KEY);
    record = raw ? JSON.parse(raw) as ContextNavigationRecord : null;
  } catch {
    // Direct navigation through the explicit fallback remains available.
  }

  try {
    const contextBack = canUseContextHistoryBack({
      record,
      currentHref: window.location.href,
      expectedReturnHref,
      origin: window.location.origin,
      runtimeId: getBrowserRuntimeId(),
      historyLength: window.history.length,
    });
    return contextBack;
  } catch {
    return false;
  }
}
