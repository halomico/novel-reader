import { NextRequest, NextResponse } from "next/server";
import { checkContentAccess } from "@/lib/content-access";
import { getMediaAsset, isMediaKindAccessible } from "@/lib/media";
import { getMediaTextPreview } from "@/lib/media-text-preview";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "file" || !isMediaKindAccessible("file", Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: "file",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) return new Response(null, { status: access.status });
  try {
    const preview = await getMediaTextPreview(asset);
    return preview
      ? NextResponse.json(preview, {
          headers: {
            "Cache-Control": "private, max-age=300",
            Vary: "Cookie",
          },
        })
      : new Response(null, { status: 404 });
  } catch {
    return NextResponse.json({ message: "预览加载失败" }, { status: 502 });
  }
}
