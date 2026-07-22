import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  canAccessAdvancedTagSearch,
  canAccessNovelLibrary,
  getFrontendSearchConcurrencyLimit,
  getSearchRateLimitRules,
  getUserSearchRateLimitPerMinute,
  shouldShowProgressBars,
} from "@/lib/config";
import { getClientIp } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  cancelContentJob,
  countActiveContentJobs,
  getContentJob,
  hasCachedContentSearchResults,
  startContentSearchJob,
} from "@/lib/content-jobs";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateSearchKeyword } from "@/lib/search";
import { countSearchChars } from "@/lib/search-query";
import { checkIpRateLimit } from "@/lib/ip-rate-limit";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { listNovelIdsByTagFilters, listVisibleTagsBySlugs } from "@/lib/tags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function getSearchAccess(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  const adminSession = await getAdminSession(user);
  return { user, adminSession, allowed: Boolean(adminSession) || canAccessNovelLibrary(Boolean(user)) };
}

function cleanSlugList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0 && item.length <= 64))).slice(0, 20);
}

export async function POST(request: NextRequest) {
  let body: { q?: unknown; filters?: unknown } = {};
  try {
    body = (await request.json()) as { q?: unknown; filters?: unknown };
  } catch {
    return jsonError("搜索请求格式有误", 400);
  }

  const validation = validateSearchKeyword(String(body.q || ""));
  if (!validation.ok) {
    return jsonError(validation.message, 400);
  }

  const { user, adminSession, allowed } = await getSearchAccess(request);
  if (!allowed) {
    return jsonError("搜索不可用", 404);
  }
  const ipLimit = checkIpRateLimit({
    category: "search",
    ip: getClientIp(request.headers),
    authenticated: Boolean(user),
    shortQuery: countSearchChars(validation.query.anchorTerm) === 2,
    rules: getSearchRateLimitRules(),
  });
  if (!ipLimit.allowed) {
    return jsonError(ipLimit.permanent ? "当前 IP 已被永久禁止搜索" : `搜索太频繁，请 ${ipLimit.retryAfterSeconds} 秒后再试`, 429);
  }

  if (user) {
    const accountLimit = checkRateLimit({
      key: `search:user:${user.id}`,
      limit: user.searchRateLimitPerMinute || getUserSearchRateLimitPerMinute(),
      windowMs: 60_000,
    });
    if (!accountLimit.allowed) {
      return jsonError(`搜索太频繁，请 ${accountLimit.retryAfterSeconds} 秒后再试`, 429);
    }
  }

  let candidateNovelIds: number[] | undefined;
  let cacheScope = "";
  if (body.filters && typeof body.filters === "object") {
    if (!adminSession && !canAccessAdvancedTagSearch(Boolean(user))) {
      return jsonError("高级搜索不可用", 404);
    }
    const filters = body.filters as Record<string, unknown>;
    const includedSlugs = cleanSlugList(filters.includeTags);
    const includedTags = listVisibleTagsBySlugs(includedSlugs);
    if (includedTags.length !== includedSlugs.length) {
      return jsonError("包含标签无效", 400);
    }
    const includedIds = includedTags.map((tag) => tag.id);
    const excludedIds = listVisibleTagsBySlugs(cleanSlugList(filters.excludeTags))
      .map((tag) => tag.id)
      .filter((id) => !includedIds.includes(id));
    const titleQuery = String(filters.titleQuery || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
    if (includedIds.length || excludedIds.length || titleQuery) {
      candidateNovelIds = listNovelIdsByTagFilters(includedIds, { excludeTagIds: excludedIds, q: titleQuery });
      cacheScope = `advanced:${crypto.createHash("sha256").update(candidateNovelIds.join(",")).digest("base64url").slice(0, 20)}`;
    }
  }

  const concurrencyLimit = getFrontendSearchConcurrencyLimit();
  if (!hasCachedContentSearchResults(validation.query, cacheScope) && countActiveContentJobs("search") >= concurrencyLimit) {
    return jsonError(`当前全文搜索任务较多，请稍后再试（上限 ${concurrencyLimit} 个）`, 429);
  }

  const job = startContentSearchJob(validation.query, { candidateNovelIds, cacheScope });
  return NextResponse.json({ ok: true, jobId: job.id, job, showProgressBars: shouldShowProgressBars() });
}

export async function GET(request: NextRequest) {
  if (!(await getSearchAccess(request)).allowed) {
    return jsonError("搜索不可用", 404);
  }
  const id = request.nextUrl.searchParams.get("id") || "";
  const job = getContentJob(id);
  if (!job || job.kind !== "search") {
    return jsonError("搜索任务不存在或已过期", 404);
  }

  return NextResponse.json({ ok: true, job, showProgressBars: shouldShowProgressBars() });
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
