import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  createMediaCoverKey,
  deleteMediaCustomCover,
  MAX_CUSTOM_MEDIA_COVER_BYTES,
  MediaCoverError,
  normalizeMediaCover,
  writeMediaCustomCover,
} from "@/lib/media-cover";
import {
  getMediaAsset,
  replaceMediaCustomCoverKey,
} from "@/lib/media";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorize(request: NextRequest) {
  return getAdminAccessState(request.headers).allowed && Boolean(await getAdminSession());
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

function refreshMediaPaths(id: number) {
  revalidatePath("/media");
  revalidatePath(`/media/${id}`);
  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}/preview`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorize(request))) return new Response(null, { status: 404 });
  const id = Number((await params).id);
  const asset = getMediaAsset(id);
  if (!asset || asset.kind !== "video") return jsonError("视频不存在", 404);
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CUSTOM_MEDIA_COVER_BYTES + 1024 * 1024) {
    return jsonError("封面图片不能超过 10 MB", 413);
  }

  let key = "";
  try {
    const formData = await request.formData();
    const file = formData.get("cover");
    if (!(file instanceof File) || file.size <= 0) {
      return jsonError("请选择封面图片", 400);
    }
    if (file.size > MAX_CUSTOM_MEDIA_COVER_BYTES) {
      return jsonError("封面图片不能超过 10 MB", 413);
    }
    const normalized = await normalizeMediaCover(Buffer.from(await file.arrayBuffer()));
    key = createMediaCoverKey();
    await writeMediaCustomCover(asset, key, normalized);
    const previousKey = replaceMediaCustomCoverKey(asset.id, key);
    if (previousKey === undefined) {
      await deleteMediaCustomCover(asset, key).catch(() => undefined);
      return jsonError("视频不存在", 404);
    }
    if (previousKey && previousKey !== key) {
      await deleteMediaCustomCover(asset, previousKey).catch((error) => {
        console.warn(`[media] failed to remove replaced custom cover for asset ${asset.id}`, error);
      });
    }
    key = "";
    refreshMediaPaths(asset.id);
    return NextResponse.json({ ok: true, message: "封面已更新" });
  } catch (error) {
    if (key) {
      await deleteMediaCustomCover(asset, key).catch(() => undefined);
    }
    if (error instanceof MediaCoverError) {
      return jsonError(error.message, error.status);
    }
    console.error("[media] custom cover upload failed", error);
    return jsonError("封面上传失败，请检查媒体节点状态", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorize(request))) return new Response(null, { status: 404 });
  const id = Number((await params).id);
  const asset = getMediaAsset(id);
  if (!asset || asset.kind !== "video") return jsonError("视频不存在", 404);
  const previousKey = replaceMediaCustomCoverKey(asset.id, null);
  if (previousKey === undefined) return jsonError("视频不存在", 404);
  if (previousKey) {
    await deleteMediaCustomCover(asset, previousKey).catch((error) => {
      console.warn(`[media] failed to remove custom cover for asset ${asset.id}`, error);
    });
  }
  const updated = getMediaAsset(asset.id);
  if (updated) scheduleMediaPreparation([updated]);
  refreshMediaPaths(asset.id);
  return NextResponse.json({ ok: true, message: "已恢复自动封面" });
}
