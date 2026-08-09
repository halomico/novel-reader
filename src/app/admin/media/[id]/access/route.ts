import { NextRequest } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getMediaAsset } from "@/lib/media";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed || !(await getAdminSession())) {
    return new Response(null, { status: 404 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) {
    return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
