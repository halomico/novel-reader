import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { checkAdminOperationLimit } from "@/lib/admin-operation-limit";
import {
  appendMediaUploadChunk,
  cancelMediaUpload,
  finishMediaUpload,
  MEDIA_UPLOAD_CHUNK_BYTES,
  MediaUploadError,
  startMediaUpload,
} from "@/lib/media-upload";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function authorize(request: NextRequest): Promise<{ clientIp: string } | NextResponse> {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return new NextResponse(null, { status: 404 });
  }
  if (!(await getAdminSession())) {
    return jsonError("请先登录后台", 401);
  }
  return { clientIp: access.clientIp };
}

function uploadError(error: unknown) {
  if (error instanceof MediaUploadError) {
    return jsonError(error.message, error.status);
  }
  console.error("Media upload failed", error);
  return jsonError("资源上传失败，请检查磁盘空间和数据目录权限", 500);
}

export async function POST(request: NextRequest) {
  const authorized = await authorize(request);
  if (authorized instanceof NextResponse) {
    return authorized;
  }
  const action = request.nextUrl.searchParams.get("action");

  try {
    if (action === "start") {
      const limitedMessage = checkAdminOperationLimit(authorized.clientIp, "media-upload");
      if (limitedMessage) {
        return jsonError(limitedMessage, 429);
      }
      const body = (await request.json()) as {
        kind?: unknown;
        title?: unknown;
        artist?: unknown;
        description?: unknown;
        folder?: unknown;
        fileName?: unknown;
        mimeType?: unknown;
        sizeBytes?: unknown;
      };
      const result = startMediaUpload({
        kind: body.kind,
        title: typeof body.title === "string" ? body.title : "",
        artist: typeof body.artist === "string" ? body.artist : "",
        description: typeof body.description === "string" ? body.description : "",
        folder: typeof body.folder === "string" ? body.folder : "",
        fileName: typeof body.fileName === "string" ? body.fileName : "",
        mimeType: typeof body.mimeType === "string" ? body.mimeType : "",
        sizeBytes: Number(body.sizeBytes),
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const uploadId = request.nextUrl.searchParams.get("uploadId") || "";
    if (action === "chunk") {
      const contentLength = Number(request.headers.get("content-length") || "0");
      if (contentLength > MEDIA_UPLOAD_CHUNK_BYTES) {
        return jsonError("上传分片过大", 413);
      }
      const offset = Number(request.headers.get("x-upload-offset"));
      const nextOffset = appendMediaUploadChunk(uploadId, offset, Buffer.from(await request.arrayBuffer()));
      return NextResponse.json({ ok: true, nextOffset });
    }

    if (action === "finish") {
      const asset = finishMediaUpload(uploadId);
      scheduleMediaPreparation([asset]);
      revalidatePath("/media");
      revalidatePath("/admin");
      revalidatePath("/admin/media");
      return NextResponse.json({ ok: true, assetId: asset.id });
    }
    return jsonError("上传操作无效", 400);
  } catch (error) {
    return uploadError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const authorized = await authorize(request);
  if (authorized instanceof NextResponse) {
    return authorized;
  }
  const uploadId = request.nextUrl.searchParams.get("uploadId") || "";
  return NextResponse.json({ ok: true, cancelled: cancelMediaUpload(uploadId) });
}
