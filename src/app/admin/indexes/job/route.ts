import { NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import {
  enqueuePostgresContentJob,
  getPostgresContentJob,
  requestPostgresContentJobCancellation,
} from "@/core/jobs/postgres-content-jobs";
import { readJsonBody } from "@/core/security/request-body";
import { getPostgresNovelSourceById } from "@/domains/catalog/postgres-catalog";
import {
  contentIndexJobProgress,
  toPostgresContentIndexJobSnapshot,
} from "@/domains/reading/postgres-content-index-job";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function requireAdminJson(request: NextRequest) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) return { ok: false as const, response: new NextResponse(null, { status: 404 }) };
  const session = await getAdminSession();
  if (!session) return { ok: false as const, response: jsonError("请先登录后台", 401) };
  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) return auth.response;
  const parsed = await readJsonBody<{ force?: unknown; sourceId?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) {
    return jsonError(parsed.reason === "too_large" ? "索引请求过大" : "索引请求格式有误", parsed.reason === "too_large" ? 413 : 400);
  }
  if (parsed.value.force !== undefined && typeof parsed.value.force !== "boolean") {
    return jsonError("索引请求格式有误", 400);
  }
  if (parsed.value.sourceId !== undefined && typeof parsed.value.sourceId !== "number") {
    return jsonError("小说书库参数无效", 400);
  }
  const sourceId = parsed.value.sourceId;
  if (sourceId !== undefined && (!Number.isSafeInteger(sourceId) || sourceId < 1 || sourceId > 2_147_483_647)) {
    return jsonError("小说书库参数无效", 400);
  }
  if (sourceId !== undefined && !await getPostgresNovelSourceById(database("web"), sourceId)) {
    return jsonError("小说书库不存在", 404);
  }
  const queued = await enqueuePostgresContentJob({
    kind: "search-index",
    dedupeKey: "content-index:global",
    payload: { force: parsed.value.force === true, ...(sourceId === undefined ? {} : { sourceId }) },
    priority: parsed.value.force === true ? 10 : 0,
    maxAttempts: 5,
  });
  const settings = await readPostgresSiteSettings();
  if (!queued.inserted) {
    return NextResponse.json({
      ok: false,
      message: "已有 PostgreSQL 正文任务正在运行",
      jobId: queued.job.id,
      job: toPostgresContentIndexJobSnapshot(queued.job),
      showProgressBars: settings.showProgressBars,
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  const initial = { ...queued.job, progress: contentIndexJobProgress() };
  return NextResponse.json({
    ok: true,
    jobId: initial.id,
    job: toPostgresContentIndexJobSnapshot(initial),
    showProgressBars: settings.showProgressBars,
  }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) return auth.response;
  try {
    const job = await getPostgresContentJob(request.nextUrl.searchParams.get("id") || "");
    if (!job || job.kind !== "search-index") return jsonError("索引任务不存在或已过期", 404);
    const settings = await readPostgresSiteSettings();
    return NextResponse.json({
      ok: true,
      job: toPostgresContentIndexJobSnapshot(job),
      showProgressBars: settings.showProgressBars,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return jsonError("索引任务不存在或已过期", 404);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) return auth.response;
  try {
    const job = await requestPostgresContentJobCancellation(request.nextUrl.searchParams.get("id") || "");
    if (!job || job.kind !== "search-index") return jsonError("索引任务不存在或已过期", 404);
    const settings = await readPostgresSiteSettings();
    return NextResponse.json({
      ok: true,
      job: toPostgresContentIndexJobSnapshot(job),
      showProgressBars: settings.showProgressBars,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return jsonError("索引任务不存在或已过期", 404);
  }
}
