import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  canAccessAdvancedTagSearch,
  canConsumeNovelLibrary,
  getFrontendSearchConcurrencyLimit,
  shouldShowProgressBars,
} from "@/lib/config";
import {
  cancelContentJob,
  countActiveContentJobs,
  getContentJob,
  hasCachedContentSearchResults,
  startContentSearchJob,
} from "@/lib/content-jobs";
import { validateSearchKeyword } from "@/lib/search";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { listNovelIdsByTagFilters, listVisibleTagsBySlugs } from "@/lib/tags";
import { checkContentAccess } from "@/lib/content-access";
import { hasUserPermission } from "@/lib/user-levels";
import { LOCALE_COOKIE, normalizeLocale, TRADITIONAL_LOCALE, type AppLocale } from "@/lib/locale";
import { localizeTexts, normalizeSearchText as normalizeLocaleSearchText } from "@/lib/locale-server";
import type { ContentJobSnapshot } from "@/lib/content-jobs";
import { listReadableNovelIds } from "@/lib/novel-access";
import { listNovelIdsBySource, resolveNovelLibraryScope } from "@/lib/novel-library";
import { isNovelSourceFullTextSearchEnabled, listFullTextSearchNovelIds } from "@/lib/novel-search-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function getSearchAccess(request: NextRequest, rateLimit = false) {
  const user = getCurrentUserFromRequest(request);
  const contentAccess = checkContentAccess(request.headers, {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit,
  });
  return {
    user,
    contentAccess,
    allowed: canConsumeNovelLibrary(Boolean(user)) && contentAccess.allowed,
  };
}

function cleanSlugList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0 && item.length <= 64))).slice(0, 20);
}

function getResponseLocale(request: NextRequest): AppLocale {
  return normalizeLocale(request.cookies.get(LOCALE_COOKIE)?.value);
}

async function localizeJob(
  job: ContentJobSnapshot,
  locale: AppLocale,
): Promise<ContentJobSnapshot> {
  if (locale !== TRADITIONAL_LOCALE) {
    return job;
  }

  const messageValues = await localizeTexts(
    [job.message || "", job.error || ""] as const,
    locale,
  );
  const results = job.results
    ? await Promise.all(job.results.map(async (result) => {
        const [title, snippet] = await localizeTexts(
          [result.title, result.snippet] as const,
          locale,
        );
        return { ...result, title, snippet };
      }))
    : undefined;
  return {
    ...job,
    message: messageValues[0],
    error: messageValues[1] || undefined,
    results,
  };
}

export async function POST(request: NextRequest) {
  let body: { q?: unknown; library?: unknown; filters?: unknown } = {};
  try {
    body = (await request.json()) as { q?: unknown; library?: unknown; filters?: unknown };
  } catch {
    return jsonError("搜索请求格式有误", 400);
  }

  const validation = validateSearchKeyword(
    await normalizeLocaleSearchText(String(body.q || "")),
  );
  if (!validation.ok) {
    return jsonError(validation.message, 400);
  }

  const { user, allowed, contentAccess } = await getSearchAccess(request, true);
  if (!allowed) {
    return contentAccess.allowed
      ? jsonError("搜索不可用", 404)
      : jsonError(contentAccess.message, contentAccess.status);
  }
  const rawFilters = body.filters && typeof body.filters === "object"
    ? body.filters as Record<string, unknown>
    : null;
  const libraryScope = resolveNovelLibraryScope(String(body.library || rawFilters?.sourceLibrary || ""));
  if (libraryScope.kind === "source" && !isNovelSourceFullTextSearchEnabled(libraryScope.source.slug)) {
    return jsonError("该书库未加入全站正文索引，请进入具体书籍后使用“本书”搜索", 400);
  }
  let candidateNovelIds: number[] | undefined;
  if (body.filters && typeof body.filters === "object") {
    const canUseAdvancedSearch = canAccessAdvancedTagSearch(false) ||
      (canAccessAdvancedTagSearch(Boolean(user)) && hasUserPermission(user, "advanced_search"));
    if (!canUseAdvancedSearch) {
      return jsonError("高级搜索不可用", 404);
    }
    const filters = body.filters as Record<string, unknown>;
    const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
    const includedSlugs = cleanSlugList(filters.includeTags);
    const includedTags = listVisibleTagsBySlugs(includedSlugs, { audience });
    if (includedTags.length !== includedSlugs.length) {
      return jsonError("包含标签无效", 400);
    }
    const includedIds = includedTags.map((tag) => tag.id);
    const excludedIds = listVisibleTagsBySlugs(cleanSlugList(filters.excludeTags), { audience })
      .map((tag) => tag.id)
      .filter((id) => !includedIds.includes(id));
    const titleQuery = (await normalizeLocaleSearchText(String(filters.titleQuery || "")))
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 80);
    if (includedIds.length || excludedIds.length || titleQuery || libraryScope.kind === "source") {
      candidateNovelIds = listNovelIdsByTagFilters(includedIds, {
        excludeTagIds: excludedIds,
        q: titleQuery,
        audience,
        sourceId: libraryScope.kind === "source" ? libraryScope.source.id : undefined,
      });
    }
  }

  const readableNovelIds = listReadableNovelIds(user);
  const allowedIds = new Set(readableNovelIds);
  const fullTextIds = new Set(listFullTextSearchNovelIds());
  const libraryIds = libraryScope.kind === "source"
    ? new Set(listNovelIdsBySource(libraryScope.source.id))
    : null;
  candidateNovelIds = (candidateNovelIds || readableNovelIds)
    .filter((id) => allowedIds.has(id) && fullTextIds.has(id) && (!libraryIds || libraryIds.has(id)));
  const cacheScope = `access:${crypto.createHash("sha256")
    .update(candidateNovelIds.join(","))
    .digest("base64url")
    .slice(0, 24)}`;

  const concurrencyLimit = getFrontendSearchConcurrencyLimit();
  if (!hasCachedContentSearchResults(validation.query, cacheScope) && countActiveContentJobs("search") >= concurrencyLimit) {
    return jsonError(`当前全文搜索任务较多，请稍后再试（上限 ${concurrencyLimit} 个）`, 429);
  }

  const job = startContentSearchJob(validation.query, { candidateNovelIds, cacheScope });
  return NextResponse.json({
    ok: true,
    jobId: job.id,
    job: await localizeJob(job, getResponseLocale(request)),
    showProgressBars: shouldShowProgressBars(),
  });
}

export async function GET(request: NextRequest) {
  if (!(await getSearchAccess(request)).allowed) {
    return jsonError("搜索不可用", 404);
  }
  const id = request.nextUrl.searchParams.get("id") || "";
  const job = getContentJob(id, request.nextUrl.searchParams.get("results") === "1");
  if (!job || job.kind !== "search") {
    return jsonError("搜索任务不存在或已过期", 404);
  }

  return NextResponse.json({
    ok: true,
    job: await localizeJob(job, getResponseLocale(request)),
    showProgressBars: shouldShowProgressBars(),
  });
}

export async function DELETE(request: NextRequest) {
  if (!(await getSearchAccess(request)).allowed) {
    return jsonError("搜索不可用", 404);
  }
  const id = request.nextUrl.searchParams.get("id") || "";
  const job = cancelContentJob(id);
  if (!job || job.kind !== "search") {
    return jsonError("搜索任务不存在或已过期", 404);
  }

  return NextResponse.json({ ok: true, job, showProgressBars: shouldShowProgressBars() });
}
