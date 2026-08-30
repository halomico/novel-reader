import { DEFAULT_LOCALE, uiText, type AppLocale } from "./locale";

export const DEFAULT_NOVEL_LIBRARY_SLUG = "default";
export const ALL_NOVEL_LIBRARIES_SLUG = "all";
export const NOVEL_LIBRARY_PREFERENCE_COOKIE_PREFIX = "novel-library-selection";

export function novelLibraryPreferenceCookieName(userId: number): string {
  const normalizedUserId = Number.isInteger(userId) && userId > 0 ? userId : 0;
  return `${NOVEL_LIBRARY_PREFERENCE_COOKIE_PREFIX}-${normalizedUserId}`;
}

export function novelLibraryDisplayName(source: { slug: string; name: string }, locale: AppLocale = DEFAULT_LOCALE): string {
  return source.slug.toLocaleLowerCase("en-US") === DEFAULT_NOVEL_LIBRARY_SLUG ? uiText(locale, "默认") : source.name;
}
