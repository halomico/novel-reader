import { NextResponse } from "next/server";
import { readSiteIconAsset } from "@/lib/site-icon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;
  const asset = readSiteIconAsset(fileName);
  if (!asset) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, max-age=31536000, immutable",
      "Cloudflare-CDN-Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(asset.bytes.byteLength),
      "Content-Type": asset.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
