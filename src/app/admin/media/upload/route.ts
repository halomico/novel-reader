import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  appendMediaUploadChunk,
  MEDIA_UPLOAD_CHUNK_BYTES,
  MediaUploadError,
} from "@/lib/media-upload";
import {
  cancelMediaStorageUpload,
  finishMediaStorageUpload,
  getLocalMediaStorageUploadOffset,
  startMediaStorageUpload,
} from "@/lib/media-upload-service";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";
import { isRemoteMediaStorage, MediaStorageConfigurationError } from "@/lib/media-storage-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function authorize(request: NextRequest): Promise<NextResponse | null> {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return new NextResponse(null, { status: 404 });
  }
  if (!(await getAdminSession())) {
    return jsonError("请先登录后台", 401);
  }
  return null;
}

function uploadError(error: unknown) {
  if (error instanceof MediaUploadError) {
    return jsonError(error.message, error.status);
  }
  if (error instanceof MediaStorageConfigurationError) {
    return jsonError(error.message, 503);
  }
  console.error("Media upload failed", error);
  return jsonError("资源上传失败，请检查存储空间和媒体节点状态", 500);
}

function browserOrigin(request: NextRequest): string {
  const supplied = request.headers.get("origin");
  if (supplied) return supplied;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

async function readUploadChunk(request: NextRequest): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MEDIA_UPLOAD_CHUNK_BYTES) {
        throw new MediaUploadError("上传分片过大", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

export async function POST(request: NextRequest) {
  const authorizationError = await authorize(request);
  if (authorizationError) {
    return authorizationError;
  }
  const action = request.nextUrl.searchParams.get("action");

  try {
    if (action === "start") {
      const body = (await request.json()) as {
        kind?: unknown;
        categoryId?: unknown;
        title?: unknown;
        artist?: unknown;
        description?: unknown;
        folder?: unknown;
        fileName?: unknown;
        mimeType?: unknown;
        sizeBytes?: unknown;
      };
      const result = await startMediaStorageUpload({
        kind: body.kind,
        categoryId: body.categoryId,
        title: typeof body.title === "string" ? body.title : "",
        artist: typeof body.artist === "string" ? body.artist : "",
        description: typeof body.description === "string" ? body.description : "",
        folder: typeof body.folder === "string" ? body.folder : "",
        fileName: typeof body.fileName === "string" ? body.fileName : "",
        mimeType: typeof body.mimeType === "string" ? body.mimeType : "",
        sizeBytes: Number(body.sizeBytes),
      }, browserOrigin(request));
      return NextResponse.json({ ok: true, ...result });
    }

    const uploadId = request.nextUrl.searchParams.get("uploadId") || "";
    if (action === "chunk") {
      if (isRemoteMediaStorage()) {
        return jsonError("远程模式的文件分片应直传媒体节点", 400);
      }
      const contentLength = Number(request.headers.get("content-length") || "0");
      if (contentLength > MEDIA_UPLOAD_CHUNK_BYTES) {
        return jsonError("上传分片过大", 413);
      }
      const offset = Number(request.headers.get("x-upload-offset"));
      const nextOffset = await appendMediaUploadChunk(uploadId, offset, await readUploadChunk(request));
      return NextResponse.json({ ok: true, nextOffset });
    }

    if (action === "finish") {
      const asset = await finishMediaStorageUpload(uploadId);
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

export async function GET(request: NextRequest) {
  const authorizationError = await authorize(request);
  if (authorizationError) {
    return authorizationError;
  }
  try {
    const uploadId = request.nextUrl.searchParams.get("uploadId") || "";
    return NextResponse.json({ ok: true, nextOffset: await getLocalMediaStorageUploadOffset(uploadId) });
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
  try {
    return NextResponse.json({ ok: true, cancelled: await cancelMediaStorageUpload(uploadId) });
  } catch (error) {
    return uploadError(error);
  }
}
