import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { persistBlockedIp } from "@/lib/admin-ban";
import { getAdminRateLimitPerMinute } from "@/lib/config";
import { saveUploadedNovels } from "@/lib/novel-files";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return jsonError(access.reason || "当前请求不能访问后台", 403);
  }

  const limit = checkRateLimit({
    key: `admin-upload:${access.clientIp}`,
    limit: getAdminRateLimitPerMinute(),
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    const blocked = persistBlockedIp(access.clientIp);
    return jsonError(blocked ? "上传太频繁，当前 IP 已加入黑名单" : `上传太频繁，请 ${limit.retryAfterSeconds} 秒后再试`, 429);
  }

  const session = await getAdminSession();
  if (!session) {
    return jsonError("请先登录后台", 401);
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) {
    return jsonError("请选择至少一个 .txt 文件", 400);
  }

  const results = await saveUploadedNovels(files);
  const saved = results.filter((item) => item.status === "saved").length;
  const duplicates = results.filter((item) => item.status === "duplicate").length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/books");

  return NextResponse.json({
    ok: true,
    saved,
    duplicates,
    skipped,
    processed: results.length,
  });
}
