import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getMediaAsset, isMediaKindEnabled, mediaFilePath, parseMediaByteRange } from "@/lib/media";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function disposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getCurrentUserFromRequest(request)) {
    return new Response(null, { status: 401 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio") || !isMediaKindEnabled(asset.kind)) {
    return new Response(null, { status: 404 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(mediaFilePath(asset.storedName));
  } catch {
    return new Response(null, { status: 404 });
  }
  const range = parseMediaByteRange(request.headers.get("range"), stat.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const stream = fs.createReadStream(mediaFilePath(asset.storedName), { start, end });
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": disposition(asset.fileName),
    "Content-Length": String(end - start + 1),
    "Content-Type": asset.mimeType,
  });
  if (range) {
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  }
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
