import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getMediaAsset, isMediaKindEnabled } from "@/lib/media";
import { ensureMediaThumbnail } from "@/lib/media-thumbnail";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getCurrentUserFromRequest(request)) {
    return new Response(null, { status: 401 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "video" || !isMediaKindEnabled(asset.kind)) {
    return new Response(null, { status: 404 });
  }

  try {
    const thumbnailPath = await ensureMediaThumbnail(asset);
    const stat = fs.statSync(thumbnailPath);
    return new Response(Readable.toWeb(fs.createReadStream(thumbnailPath)) as ReadableStream<Uint8Array>, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(stat.size),
        "Content-Type": "image/jpeg",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
