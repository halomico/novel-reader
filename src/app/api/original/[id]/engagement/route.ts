import { type NextRequest, NextResponse } from "next/server";
import { recordOriginalEngagement } from "@/domains/originals";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const articleId = Number((await params).id);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) {
    return NextResponse.json({ error: "invalid_article" }, { status: 400 });
  }

  const user = getCurrentUserFromRequest(request);
  const result = recordOriginalEngagement(articleId, user?.id);
  return result.recorded
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "article_not_found" }, { status: 404 });
}
