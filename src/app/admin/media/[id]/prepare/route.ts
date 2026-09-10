import { NextRequest, NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import {
  schedulePostgresMediaPlaybackPreparation,
  schedulePostgresMediaPreparation,
} from "@/domains/media/postgres-media-preparation";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getAdminAccessState(request.headers).allowed || !(await getAdminSession())) {
    return new Response(null, { status: 404 });
  }
  const asset = await getPostgresMediaAsset(database("web"), Number((await params).id));
  if (!asset || asset.kind === "file") {
    return NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
  }
  await schedulePostgresMediaPreparation([asset], { force: true });
  if (asset.kind === "video") await schedulePostgresMediaPlaybackPreparation(asset, { force: true });
  return NextResponse.json({ ok: true, message: "已重新加入准备队列" });
}
