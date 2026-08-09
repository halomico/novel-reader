import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  appendMarketAssetUploadChunk,
  cancelMarketAssetUpload,
  finishMarketAssetUpload,
  getMarketAssetUploadOffset,
  startMarketAssetUpload,
} from "@/lib/market-upload";
import { MEDIA_UPLOAD_CHUNK_BYTES } from "@/lib/media-node-protocol";
import { isRemoteMediaStorage } from "@/lib/media-storage-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function authorize(request: NextRequest): Promise<NextResponse | null> {
  if (!getAdminAccessState(request.headers).allowed) {
    return new NextResponse(null, { status: 404 });
  }
  return (await getAdminSession()) ? null : jsonError("请先登录后台", 401);
}

function browserOrigin(request: NextRequest): string {
  const supplied = request.headers.get("origin");
  if (supplied) return supplied;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

async function readChunk(request: NextRequest): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MEDIA_UPLOAD_CHUNK_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("上传分片过大");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

function uploadError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "文件上传失败";
  const status = /不存在/.test(message) ? 404 : /过大/.test(message) ? 413 : 400;
  return jsonError(message, status);
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  const action = request.nextUrl.searchParams.get("action");
  try {
    if (action === "start") {
      const body = (await request.json()) as Record<string, unknown>;
      const started = await startMarketAssetUpload({
        productId: Number(body.productId),
        fileName: String(body.fileName || ""),
        mimeType: String(body.mimeType || ""),
        sizeBytes: Number(body.sizeBytes),
        allowedOrigin: browserOrigin(request),
      });
      return NextResponse.json({ ok: true, ...started });
    }
    const uploadId = request.nextUrl.searchParams.get("uploadId") || "";
    if (action === "chunk") {
      if (isRemoteMediaStorage()) return jsonError("远程分片应直传媒体节点", 400);
      const offset = Number(request.headers.get("x-upload-offset"));
      const nextOffset = await appendMarketAssetUploadChunk(uploadId, offset, await readChunk(request));
      return NextResponse.json({ ok: true, nextOffset });
    }
    if (action === "finish") {
      const asset = await finishMarketAssetUpload(uploadId);
      return NextResponse.json({ ok: true, asset });
    }
    return jsonError("上传操作无效", 400);
  } catch (error) {
    return uploadError(error);
  }
}

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json({
      ok: true,
      nextOffset: await getMarketAssetUploadOffset(request.nextUrl.searchParams.get("uploadId") || ""),
    });
  } catch (error) {
    return uploadError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json({
      ok: true,
      cancelled: await cancelMarketAssetUpload(request.nextUrl.searchParams.get("uploadId") || ""),
    });
  } catch (error) {
    return uploadError(error);
  }
}
