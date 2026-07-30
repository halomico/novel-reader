import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { findLocalStoredCover } from "@/lib/media-cover";
import { getMarketProductById } from "@/lib/market";
import { createSignedMediaCoverUrl } from "@/lib/media-signing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, immutable",
  "Cloudflare-CDN-Cache-Control": "public, max-age=86400",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const product = getMarketProductById(Number((await params).id));
  if (!product?.coverKey || request.nextUrl.searchParams.get("v") !== product.coverKey) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (product.coverStorageNodeId) {
    return new Response(null, {
      status: 307,
      headers: {
        ...CACHE_HEADERS,
        Location: createSignedMediaCoverUrl({
          storageNodeId: product.coverStorageNodeId,
          key: product.coverKey,
          publiclyAccessible: true,
        }),
      },
    });
  }
  const coverPath = await findLocalStoredCover(product.coverKey);
  if (!coverPath) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const stat = fs.statSync(coverPath);
  const etag = `"market-cover-${product.coverKey}-${stat.size}"`;
  const headers = {
    ...CACHE_HEADERS,
    "Content-Length": String(stat.size),
    "Content-Type": "image/jpeg",
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(
    Readable.toWeb(fs.createReadStream(coverPath)) as ReadableStream<Uint8Array>,
    { headers },
  );
}
