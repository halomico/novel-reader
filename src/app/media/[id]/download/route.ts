import { NextRequest, NextResponse } from "next/server";
import { getMediaAsset, incrementMediaDownloadCount, isMediaKindConsumable } from "@/lib/media";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { hasValidVideoDownloadSession, unlockVideoDownloadWithSoda } from "@/lib/media-access";
import { checkContentAccess } from "@/lib/content-access";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (
    !asset ||
    (asset.kind !== "file" && asset.kind !== "video") ||
    !isMediaKindConsumable(asset.kind, Boolean(user)) ||
    (asset.kind === "video" && (
      !user || (user.role !== "admin" && !hasValidVideoDownloadSession({
        userId: user.id,
        mediaId: asset.id,
        token: request.nextUrl.searchParams.get("session") || "",
      }))
    ))
  ) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    return new Response(null, {
      status: access.status,
      headers: access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : undefined,
    });
  }
  incrementMediaDownloadCount(asset.id);
  let location: string;
  try {
    location = mediaDeliveryUrl(asset, true, {
      downloadToken: asset.kind === "video" && user?.role !== "admin"
        ? request.nextUrl.searchParams.get("session") || ""
        : undefined,
    });
  } catch {
    return new Response(null, { status: 503 });
  }
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store",
      Location: location,
      Vary: "Cookie",
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录后下载" }, { status: 401 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "video" || !isMediaKindConsumable("video", true)) {
    return NextResponse.json({ ok: false, message: "视频不存在" }, { status: 404 });
  }
  if (user.role !== "admin" && !hasUserPermission(user, "video_download")) {
    return NextResponse.json({ ok: false, message: "当前等级暂未开放视频下载" }, { status: 403 });
  }
  const access = checkContentAccess(request.headers, {
    scope: "video",
    authenticated: true,
    admin: user.role === "admin",
  });
  if (!access.allowed) {
    return NextResponse.json(
      { ok: false, message: "当前无法下载此视频" },
      {
        status: access.status,
        headers: access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : undefined,
      },
    );
  }
  const result = unlockVideoDownloadWithSoda({ userId: user.id, mediaId: asset.id });
  if (!result.ok) {
    const insufficient = result.reason === "insufficient_soda";
    const dailyLimit = result.reason === "daily_limit";
    return NextResponse.json(
      {
        ok: false,
        message: insufficient
          ? "苏打余额不足"
          : dailyLimit
            ? "今日下载次数已达当前等级上限"
            : "暂时无法建立下载会话",
      },
      { status: insufficient ? 409 : dailyLimit ? 429 : result.reason === "not_found" ? 404 : 403 },
    );
  }
  return NextResponse.json({
    ok: true,
    charged: result.charged,
    sodaBalance: result.sodaBalance,
    ticketExpiresAt: result.ticketExpiresAt,
    downloadUrl: `/media/${asset.id}/download?session=${encodeURIComponent(result.sessionToken)}`,
  });
}
