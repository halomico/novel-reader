import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { checkAdminOperationLimit } from "@/lib/admin-operation-limit";
import { shouldShowProgressBars } from "@/lib/config";
import { cancelContentJob, countActiveContentJobs, getContentJob, startContentIndexJob } from "@/lib/content-jobs";
import { normalizeContentIndexTerms } from "@/lib/content-index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const INVALID_INDEX_TERM_PATTERN = /[\s\p{P}\p{S}]/u;

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function requireAdminJson(request: NextRequest, scope = "") {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return { ok: false as const, response: new NextResponse(null, { status: 404 }) };
  }

  const session = await getAdminSession();
  if (!session) {
    return { ok: false as const, response: jsonError("请先登录后台", 401) };
  }

  if (scope) {
    const limitedMessage = checkAdminOperationLimit(access.clientIp, scope);
    if (limitedMessage) {
      return { ok: false as const, response: jsonError(limitedMessage, 429) };
    }
  }

  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminJson(request, "indexes-job");
  if (!auth.ok) {
    return auth.response;
  }

  let body: { term?: unknown; terms?: unknown } = {};
  try {
    body = (await request.json()) as { term?: unknown; terms?: unknown };
  } catch {
    return jsonError("索引请求格式有误", 400);
  }

  const rawTerms = Array.isArray(body.terms) ? body.terms.map((item) => String(item || "")) : String(body.term || "").split(/[\n,]/);
  const invalidTerm = rawTerms.map((item) => item.trim()).filter(Boolean).find((term) => INVALID_INDEX_TERM_PATTERN.test(term));
  if (invalidTerm) {
    return jsonError(`索引词“${invalidTerm}”不能包含空格、标点或符号`, 400);
  }
  const terms = normalizeContentIndexTerms(rawTerms);
  if (!terms.length) {
    return jsonError("请输入索引关键词", 400);
  }
  if (countActiveContentJobs("index") > 0) {
    return jsonError("已有索引任务正在运行，请等待完成或先取消当前任务", 409);
  }

  const job = startContentIndexJob(terms);
  return NextResponse.json({ ok: true, jobId: job.id, job, showProgressBars: shouldShowProgressBars() });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) {
    return auth.response;
  }

  const id = request.nextUrl.searchParams.get("id") || "";
  const job = getContentJob(id);
  if (!job || job.kind !== "index") {
    return jsonError("索引任务不存在或已过期", 404);
  }

  return NextResponse.json({ ok: true, job, showProgressBars: shouldShowProgressBars() });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) {
    return auth.response;
  }

  const id = request.nextUrl.searchParams.get("id") || "";
  const job = cancelContentJob(id);
  if (!job || job.kind !== "index") {
    return jsonError("索引任务不存在或已过期", 404);
  }

  return NextResponse.json({ ok: true, job, showProgressBars: shouldShowProgressBars() });
}
