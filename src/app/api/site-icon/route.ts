import { NextResponse } from "next/server";
import { readSiteIconAsset } from "@/lib/site-icon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const asset = readSiteIconAsset();
  if (!asset) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": asset.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
