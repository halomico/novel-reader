import { NextRequest, NextResponse } from "next/server";
import {
  getFrontendSearchConcurrencyLimit,
  getSearchRateLimitRules,
  getUserSearchRateLimitPerMinute,
  shouldShowProgressBars,
} from "@/lib/config";
import { getClientIp } from "@/lib/admin-access";
import { cancelContentJob, countActiveContentJobs, getContentJob, startContentSearchJob } from "@/lib/content-jobs";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateSearchKeyword } from "@/lib/search";
import { countSearchChars } from "@/lib/search-query";
import { checkIpRateLimit } from "@/lib/ip-rate-limit";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  let body: { q?: unknown } = {};
  try {
    body = (await request.json()) as { q?: unknown };
  } catch {
    return jsonError("搜索请求格式有误", 400);
  }

  const validation = validateSearchKeyword(String(body.q || ""));
  if (!validation.ok) {
    return jsonError(validation.message, 400);
  }

  const user = getCurrentUserFromRequest(request);
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

  const concurrencyLimit = getFrontendSearchConcurrencyLimit();
  if (countActiveContentJobs("search") >= concurrencyLimit) {
    return jsonError(`当前全文搜索任务较多，请稍后再试（上限 ${concurrencyLimit} 个）`, 429);
  }

  const job = startContentSearchJob(validation.query);
  return NextResponse.json({ ok: true, jobId: job.id, job, showProgressBars: shouldShowProgressBars() });
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") || "";
  const job = getContentJob(id);
  if (!job || job.kind !== "search") {
    return jsonError("搜索任务不存在或已过期", 404);
  }

  return NextResponse.json({ ok: true, job, showProgressBars: shouldShowProgressBars() });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") || "";
  const job = cancelContentJob(id);
  if (!job || job.kind !== "search") {
    return jsonError("搜索任务不存在或已过期", 404);
  }

  return NextResponse.json({ ok: true, job, showProgressBars: shouldShowProgressBars() });
}
