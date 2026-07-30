import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getMediaDir } from "@/lib/config";
import {
  getMarketAssetById,
  getUserMarketOrder,
  userOwnsMarketAsset,
} from "@/lib/market";
import { parseMediaByteRange } from "@/lib/media";
import { createSignedMediaUrl } from "@/lib/media-signing";
import { isRemoteMediaStorage } from "@/lib/media-storage-config";
import { resolveMediaStoragePath } from "@/lib/media-storage-path";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function disposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orderNo: string; assetId: string }> },
) {
  const user = getCurrentUserFromRequest(request);
  if (!user) return new Response(null, { status: 401 });
  const params = await context.params;
  const order = getUserMarketOrder(user.id, params.orderNo);
  const assetId = Number(params.assetId);
  const asset = getMarketAssetById(assetId);
  if (!order || !asset || !userOwnsMarketAsset(user.id, order.id, assetId)) {
    return new Response(null, { status: 404 });
  }

  if (asset.storageNodeId && isRemoteMediaStorage()) {
    return Response.redirect(createSignedMediaUrl({
      storageNodeId: asset.storageNodeId,
      storedName: asset.storedName,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      mtimeMs: asset.mtimeMs,
      sizeBytes: asset.sizeBytes,
      download: true,
    }), 307);
  }

  let stat: fs.Stats;
  let filePath: string;
  try {
    filePath = resolveMediaStoragePath(getMediaDir(), asset.storedName);
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!stat.isFile() || stat.size !== asset.sizeBytes) {
    return new Response(null, { status: 404 });
  }
  const range = parseMediaByteRange(request.headers.get("range"), stat.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": disposition(asset.fileName),
    "Content-Length": String(end - start + 1),
    "Content-Type": asset.mimeType,
    "X-Content-Type-Options": "nosniff",
  });
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers,
  });
}
