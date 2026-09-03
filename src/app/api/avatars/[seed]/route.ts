import { renderGeneratedAvatarSvg } from "@/lib/generated-avatar";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(_request: Request, { params }: { params: Promise<{ seed: string }> }) {
  const { seed } = await params;
  if (!/^\d{1,12}-[a-f0-9]{1,16}\.svg$/.test(seed)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(renderGeneratedAvatarSvg(seed.slice(0, -4)), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
