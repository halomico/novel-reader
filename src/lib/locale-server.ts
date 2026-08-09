import { headers } from "next/headers";
import type { NovelSegment } from "./segments";
import {
  DEFAULT_LOCALE,
  LOCALE_REQUEST_HEADER,
  normalizeLocale,
  TRADITIONAL_LOCALE,
  type AppLocale,
} from "./locale";

type TextConverter = (text: string) => string;

type OpenCcModule = {
  Converter(options: { from: "cn" | "tw" | "hk"; to: "cn" | "tw" | "hk" }): TextConverter;
};

type LocalizedSegmentCacheEntry = {
  estimatedBytes: number;
  segments: NovelSegment[];
};

type LocaleGlobal = typeof globalThis & {
  traditionalConverter?: Promise<TextConverter>;
  simplifiedConverter?: Promise<TextConverter>;
  localizedSegmentCache?: Map<string, LocalizedSegmentCacheEntry>;
  localizedSegmentCacheBytes?: number;
};

const SEGMENT_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const SEGMENT_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const SEGMENT_CACHE_MAX_ENTRIES = 32;

async function loadConverter(direction: "traditional" | "simplified"): Promise<TextConverter> {
  const state = globalThis as LocaleGlobal;
  if (direction === "traditional") {
    state.traditionalConverter ||= import("opencc-js/cn2t").then((module) => (
      (module as OpenCcModule).Converter({ from: "cn", to: "tw" })
    ));
    return state.traditionalConverter;
  }

  state.simplifiedConverter ||= import("opencc-js/t2cn").then((module) => (
    (module as OpenCcModule).Converter({ from: "tw", to: "cn" })
  ));
  return state.simplifiedConverter;
}

export async function getRequestLocale(): Promise<AppLocale> {
  const requestHeaders = await headers();
  return normalizeLocale(requestHeaders.get(LOCALE_REQUEST_HEADER));
}

export async function localizeText(text: string, locale: AppLocale): Promise<string> {
  if (!text || locale === DEFAULT_LOCALE) {
    return text;
  }
  return (await loadConverter("traditional"))(text);
}

export async function localizeTexts<T extends readonly string[]>(
  values: T,
  locale: AppLocale,
): Promise<{ [K in keyof T]: string }> {
  if (locale === DEFAULT_LOCALE) {
    return [...values] as { [K in keyof T]: string };
  }
  const converter = await loadConverter("traditional");
  return values.map((value) => converter(value)) as { [K in keyof T]: string };
}

export async function normalizeSearchText(text: string): Promise<string> {
  if (!text.trim()) {
    return text;
  }
  return (await loadConverter("simplified"))(text);
}

export async function localizeNovelSegments(
  segments: NovelSegment[],
  locale: AppLocale,
  contentVersion: string,
): Promise<NovelSegment[]> {
  if (locale !== TRADITIONAL_LOCALE || !segments.length) {
    return segments;
  }

  const state = globalThis as LocaleGlobal;
  state.localizedSegmentCache ||= new Map();
  state.localizedSegmentCacheBytes ||= 0;
  const cache = state.localizedSegmentCache;
  const key = `${locale}:${contentVersion}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.segments;
  }

  const converter = await loadConverter("traditional");
  const localized = segments.map((segment) => ({
    ...segment,
    content: converter(segment.content),
  }));
  const estimatedBytes = localized.reduce((total, segment) => total + segment.content.length * 2, 0);
  if (estimatedBytes <= SEGMENT_CACHE_MAX_ENTRY_BYTES) {
    while (
      cache.size >= SEGMENT_CACHE_MAX_ENTRIES ||
      (state.localizedSegmentCacheBytes || 0) + estimatedBytes > SEGMENT_CACHE_MAX_BYTES
    ) {
      const oldest = cache.entries().next().value as [string, LocalizedSegmentCacheEntry] | undefined;
      if (!oldest) break;
      cache.delete(oldest[0]);
      state.localizedSegmentCacheBytes = Math.max(
        0,
        (state.localizedSegmentCacheBytes || 0) - oldest[1].estimatedBytes,
      );
    }
    cache.set(key, { segments: localized, estimatedBytes });
    state.localizedSegmentCacheBytes = (state.localizedSegmentCacheBytes || 0) + estimatedBytes;
  }
  return localized;
}

export function clearLocalizedContentCache() {
  const state = globalThis as LocaleGlobal;
  state.localizedSegmentCache?.clear();
  state.localizedSegmentCacheBytes = 0;
}
