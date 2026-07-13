import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getMediaAsset, incrementMediaDownloadCount, isMediaKindEnabled, mediaFilePath } from "@/lib/media";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function disposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getCurrentUserFromRequest(request)) {
    return new Response(null, { status: 401 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "file" || !isMediaKindEnabled(asset.kind)) {
    return new Response(null, { status: 404 });
  }
  const filePath = mediaFilePath(asset.storedName);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Response(null, { status: 404 });
  }
  incrementMediaDownloadCount(asset.id);
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": disposition(asset.fileName),
    "Content-Length": String(stat.size),
    "Content-Type": asset.mimeType,
  });
  return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>, { status: 200, headers });
}
