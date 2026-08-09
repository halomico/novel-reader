import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getMediaAsset } from "@/lib/media";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";
import { scheduleMediaPlaybackPreparation } from "@/lib/media-playback-preparation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getAdminAccessState(request.headers).allowed || !(await getAdminSession())) {
    return new Response(null, { status: 404 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind === "file") {
    return NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
  }
  scheduleMediaPreparation([asset], { force: true });
  if (asset.kind === "video") scheduleMediaPlaybackPreparation(asset, { force: true });
  return NextResponse.json({ ok: true, message: "已重新加入准备队列" });
}
