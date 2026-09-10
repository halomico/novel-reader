import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { hasPostgresUserPermission } from "@/domains/identity/postgres-permissions";
import {
  searchPostgresContent,
  type PostgresContentSearchCursor,
} from "@/domains/reading/postgres-content-search";
import {
  findNormalizedChineseSearchRanges,
  normalizeChineseSearchNeedles,
} from "@/domains/reading/content-text";
import { canBrowseHomePortal, canConsumeHomePortal } from "@/lib/home-portal";
import { LOCALE_COOKIE, normalizeLocale, TRADITIONAL_LOCALE } from "@/lib/locale";
import { localizeTexts, normalizeSearchText as normalizeLocaleSearchText } from "@/lib/locale-server";
import { parseSimpleAndSearchQuery, validateSearchKeyword } from "@/lib/search-query";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CURSOR_BYTES = 512;

type SearchFilters = {
  includeTags: string[];
  excludeTags: string[];
  titleQuery: string;
};

type SearchBody = {
  q?: unknown;
  library?: unknown;
  novelId?: unknown;
  page?: unknown;
  cursor?: unknown;
  filters?: unknown;
};

type CursorPayload = {
  v: 1;
  m: string;
  d: string;
  s: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function normalizedSlug(value: unknown): string {
  if (value !== undefined && value !== null && typeof value !== "string") throw new Error("invalid_library");
  const slug = String(value || "default").normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!slug || slug.length > 64 || /[\0\r\n]/u.test(slug)) throw new Error("invalid_library");
  return slug;
}

function cleanSlugList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== "string")) return null;
  const slugs = [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.normalize("NFKC").trim().toLocaleLowerCase("en-US"))
    .filter(Boolean))];
  return slugs.every((item) => item.length <= 64 && !/[\0\r\n]/u.test(item)) ? slugs : null;
}

function cleanFilters(value: unknown): SearchFilters | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "includeTags" && key !== "excludeTags" && key !== "titleQuery")) return null;
  const includeTags = cleanSlugList(source.includeTags);
  const excludeTags = cleanSlugList(source.excludeTags);
  if (!includeTags || !excludeTags || (source.titleQuery !== undefined && typeof source.titleQuery !== "string")) return null;
  return {
    includeTags,
    excludeTags: excludeTags.filter((slug) => !includeTags.includes(slug)),
    titleQuery: String(source.titleQuery || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80),
  };
}

function searchScope(keyword: string, library: string, novelId: number | undefined, filters: SearchFilters | null): string {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ keyword, library, novelId, filters }))
    .digest("base64url")
    .slice(0, 24);
}

function decodeCursor(value: unknown, scope: string): PostgresContentSearchCursor | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > MAX_CURSOR_BYTES || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid_cursor");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_cursor");
    const cursor = parsed as Partial<CursorPayload>;
    if (cursor.v !== 1 || cursor.s !== scope || typeof cursor.m !== "string" || typeof cursor.d !== "string") {
      throw new Error("invalid_cursor");
    }
    if (!/^(?:0|[1-9]\d{0,18})$/u.test(cursor.m) || !/^[1-9]\d{0,18}$/u.test(cursor.d) ||
        BigInt(cursor.m) > 9_223_372_036_854_775_807n || BigInt(cursor.d) > 9_223_372_036_854_775_807n) {
      throw new Error("invalid_cursor");
    }
    return { mtimeMs: cursor.m, documentId: cursor.d };
  } catch {
    throw new Error("invalid_cursor");
  }
}

function encodeCursor(cursor: PostgresContentSearchCursor | null, scope: string): string | null {
  if (!cursor) return null;
  const payload: CursorPayload = { v: 1, m: cursor.mtimeMs, d: cursor.documentId, s: scope };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const parsed = await readJsonBody<SearchBody>(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return jsonError(parsed.reason === "too_large" ? "搜索请求过大" : "搜索请求格式有误", parsed.reason === "too_large" ? 413 : 400);
  }

  const keywordInput = await normalizeLocaleSearchText(String(parsed.value.q || ""));
  const validation = validateSearchKeyword(keywordInput);
  if (!validation.ok) return jsonError(validation.message, 400);

  const [user, settings] = await Promise.all([
    getCurrentUserFromRequest(request),
    readPostgresSiteSettings(),
  ]);
  if (!canConsumeHomePortal(settings.homePortalAccessModes.novels, Boolean(user))) {
    return jsonError("搜索不可用", 404);
  }
  const access = await checkPostgresContentAccess(database("web"), request.headers, {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    const response = jsonError(access.message, access.status);
    if (access.retryAfterSeconds) response.headers.set("Retry-After", String(access.retryAfterSeconds));
    return response;
  }

  let library: string;
  try {
    library = normalizedSlug(parsed.value.library === undefined ? settings.defaultNovelLibrarySlug : parsed.value.library);
  } catch {
    return jsonError("书库参数无效", 400);
  }
  if (library !== "all" && settings.novelSourceSearchModes[library] === "book") {
    return jsonError("该书库未加入全站正文索引，请进入具体书籍后使用“本书”搜索", 400);
  }

  const filters = cleanFilters(parsed.value.filters);
  if (parsed.value.filters !== undefined && !filters) return jsonError("高级搜索条件格式有误", 400);
  if (filters) {
    const advancedVisible = canBrowseHomePortal(settings.homePortalAccessModes.tags, Boolean(user)) && settings.advancedTagSearchEnabled;
    const advancedPublic = canBrowseHomePortal(settings.homePortalAccessModes.tags, false) &&
      settings.advancedTagSearchEnabled && settings.guestAdvancedTagSearchEnabled;
    const advancedMember = advancedVisible && await hasPostgresUserPermission(database("web"), user, "advanced_search");
    if (!advancedPublic && !advancedMember) {
      return jsonError("高级搜索不可用", 404);
    }
  }

  const titleValidation = filters?.titleQuery
    ? parseSimpleAndSearchQuery(await normalizeLocaleSearchText(filters.titleQuery), { mode: "title" })
    : null;
  if (titleValidation && !titleValidation.ok) return jsonError(titleValidation.message, 400);

  const novelId = parsed.value.novelId === undefined || typeof parsed.value.novelId !== "number"
    ? undefined
    : parsed.value.novelId;
  if (parsed.value.novelId !== undefined && typeof parsed.value.novelId !== "number") {
    return jsonError("小说参数无效", 400);
  }
  if (novelId !== undefined && (!Number.isSafeInteger(novelId) || novelId < 1 || novelId > 2_147_483_647)) {
    return jsonError("小说参数无效", 400);
  }
  const pageSize = settings.searchResultsPageSize;
  const pageInput = parsed.value.page === undefined ? 1 : Number(parsed.value.page);
  if (!Number.isSafeInteger(pageInput) || pageInput < 1 || pageInput > Math.floor(2_147_483_647 / pageSize) + 1) {
    return jsonError("分页参数无效", 400);
  }
  const scope = searchScope(validation.keyword, library, novelId, filters);
  let cursor: PostgresContentSearchCursor | undefined;
  try {
    cursor = decodeCursor(parsed.value.cursor, scope);
  } catch {
    return jsonError("搜索游标无效或已过期", 400);
  }

  const excludedSourceSlugs = Object.entries(settings.novelSourceSearchModes)
    .filter(([, mode]) => mode === "book")
    .map(([slug]) => slug);
  const usingCursor = parsed.value.page === undefined && cursor !== undefined;
  const page = await searchPostgresContent(database("web"), validation.query, {
    novelId,
    sourceSlug: library,
    excludedSourceSlugs,
    includeTagSlugs: filters?.includeTags,
    excludeTagSlugs: filters?.excludeTags,
    titleQuery: titleValidation?.ok ? titleValidation.query : undefined,
    audience: user?.role === "admin" ? "admin" : user ? "member" : "public",
    cursor: parsed.value.page === undefined ? cursor : undefined,
    offset: parsed.value.page === undefined && cursor ? undefined : (pageInput - 1) * pageSize,
    limit: pageSize,
    includeTotals: !usingCursor,
  });
  const locale = normalizeLocale(request.cookies.get(LOCALE_COOKIE)?.value);
  const highlightNeedles = locale === TRADITIONAL_LOCALE
    ? await normalizeChineseSearchNeedles(validation.query.highlightTerms.map((term) => term.value))
    : null;
  const items = locale === TRADITIONAL_LOCALE
    ? await Promise.all(page.items.map(async (item) => {
        const [novelTitle, chapterTitle, snippet] = await localizeTexts(
          [item.novelTitle, item.chapterTitle || "", item.snippet] as const,
          locale,
        );
        const highlightRanges = await findNormalizedChineseSearchRanges(snippet, highlightNeedles!);
        return { ...item, novelTitle, chapterTitle: chapterTitle || null, snippet, highlightRanges };
      }))
    : page.items;

  return NextResponse.json({
    ok: true,
    items,
    nextCursor: encodeCursor(page.nextCursor, scope),
    totalItems: page.totalItems,
    totalNovels: page.totalNovels,
    totalPages: page.totalItems === null ? null : Math.max(1, Math.ceil(page.totalItems / pageSize)),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
