import { NextRequest, NextResponse } from "next/server";
import { getMediaAsset, isMediaKindAccessible } from "@/lib/media";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import {
  createVideoPlaybackLease,
  getVideoConcurrencyLimit,
  refreshVideoPlaybackLease,
  releaseVideoPlaybackLease,
} from "@/lib/video-playback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function body(request: NextRequest): Promise<{
  mediaId: number;
  sessionId: string;
  token: string;
}> {
  try {
    const value = await request.json() as Record<string, unknown>;
    return {
      mediaId: Number(value.mediaId),
      sessionId: String(value.sessionId || ""),
      token: String(value.token || ""),
    };
  } catch {
    return { mediaId: 0, sessionId: "", token: "" };
  }
}

export async function POST(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  const input = await body(request);
  const asset = getMediaAsset(input.mediaId);
  if (!asset || asset.kind !== "video" || !isMediaKindAccessible("video", true)) {
    return NextResponse.json({ ok: false, message: "视频不存在" }, { status: 404 });
  }
  const result = createVideoPlaybackLease({
    userId: user.id,
    mediaId: asset.id,
    limit: getVideoConcurrencyLimit(user),
  });
  if (!result.ok) {
    const message = result.reason === "limit_reached"
      ? `同时播放的视频已达到上限（${result.limit}）`
      : result.reason === "not_allowed"
        ? "当前等级暂不能播放视频"
        : "视频不存在";
    return NextResponse.json({ ok: false, message }, { status: result.reason === "limit_reached" ? 409 : 403 });
  }
  return NextResponse.json({
    ok: true,
    sessionId: result.lease.id,
    token: result.lease.token,
    expiresAt: result.lease.expiresAt,
  });
}

export async function PATCH(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const input = await body(request);
  const expiresAt = refreshVideoPlaybackLease({
    id: input.sessionId,
    token: input.token,
    userId: user.id,
    mediaId: input.mediaId,
  });
  return expiresAt
    ? NextResponse.json({ ok: true, expiresAt })
    : NextResponse.json({ ok: false, message: "播放会话已失效" }, { status: 404 });
}

export async function DELETE(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: true });
  const input = await body(request);
  releaseVideoPlaybackLease({
    id: input.sessionId,
    token: input.token,
    userId: user.id,
    mediaId: input.mediaId,
  });
  return NextResponse.json({ ok: true });
}
