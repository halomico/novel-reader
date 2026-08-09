import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  createMediaCoverKey,
  deleteStoredCover,
  MAX_CUSTOM_MEDIA_COVER_BYTES,
  MediaCoverError,
  normalizeMediaCover,
  writeStoredCover,
} from "@/lib/media-cover";
import {
  getMarketProductById,
  replaceMarketProductCover,
} from "@/lib/market";
import {
  getRemoteMediaNodeForKind,
  isRemoteMediaStorage,
} from "@/lib/media-storage-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function authorize(request: NextRequest): Promise<boolean> {
  return getAdminAccessState(request.headers).allowed && Boolean(await getAdminSession());
}

function refreshProduct(id: number, slug: string) {
  revalidatePath("/market");
  revalidatePath(`/market/${slug}`);
  revalidatePath("/admin/market");
  revalidatePath(`/admin/market/${id}`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authorize(request))) return new Response(null, { status: 404 });
  const product = getMarketProductById(Number((await params).id));
  if (!product) return jsonError("商品不存在", 404);
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CUSTOM_MEDIA_COVER_BYTES + 1024 * 1024) {
    return jsonError("封面图片不能超过 10 MB", 413);
  }

  const storageNodeId = isRemoteMediaStorage()
    ? getRemoteMediaNodeForKind("file").id
    : null;
  let key = "";
  try {
    const formData = await request.formData();
    const file = formData.get("cover");
    if (!(file instanceof File) || file.size <= 0) {
      return jsonError("请选择封面图片", 400);
    }
    const normalized = await normalizeMediaCover(Buffer.from(await file.arrayBuffer()));
    key = createMediaCoverKey();
    await writeStoredCover(storageNodeId, key, normalized);
    const previous = replaceMarketProductCover(product.id, { key, storageNodeId });
    if (previous) {
      await deleteStoredCover(previous.storageNodeId, previous.key).catch((error) => {
        console.warn(`[market] failed to remove replaced cover for product ${product.id}`, error);
      });
    }
    refreshProduct(product.id, product.slug);
    return NextResponse.json({ ok: true, message: "封面已更新", coverKey: key });
  } catch (error) {
    if (key) await deleteStoredCover(storageNodeId, key).catch(() => undefined);
    if (error instanceof MediaCoverError) {
      return jsonError(error.message, error.status);
    }
    console.error("[market] product cover upload failed", error);
    return jsonError("封面上传失败，请检查媒体节点状态", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authorize(request))) return new Response(null, { status: 404 });
  const product = getMarketProductById(Number((await params).id));
  if (!product) return jsonError("商品不存在", 404);
  const previous = replaceMarketProductCover(product.id, null);
  if (previous) {
    await deleteStoredCover(previous.storageNodeId, previous.key).catch((error) => {
      console.warn(`[market] failed to remove cover for product ${product.id}`, error);
    });
  }
  refreshProduct(product.id, product.slug);
  return NextResponse.json({ ok: true, message: "封面已删除" });
}
