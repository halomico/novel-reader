import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { shouldShowProgressBars } from "@/lib/config";
import { cancelContentJob, countActiveContentJobs, getContentJob, startContentIndexJob } from "@/lib/content-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function requireAdminJson(request: NextRequest) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return { ok: false as const, response: new NextResponse(null, { status: 404 }) };
  }

  const session = await getAdminSession();
  if (!session) {
    return { ok: false as const, response: jsonError("请先登录后台", 401) };
  }

  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: { force?: unknown } = {};
  try {
    body = (await request.json()) as { force?: unknown };
  } catch {
    return jsonError("索引请求格式有误", 400);
  }
  if (countActiveContentJobs("index") > 0) {
    return jsonError("已有索引任务正在运行，请等待完成或先取消当前任务", 409);
  }

  const job = startContentIndexJob({ force: body.force === true });
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
