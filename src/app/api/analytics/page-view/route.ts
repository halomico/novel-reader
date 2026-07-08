import { NextRequest, NextResponse } from "next/server";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function novelIdFromPath(path: string): number | null {
  const match = path.match(/^\/books\/(\d+)(?:[/?#]|$)/);
  if (!match) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const payload = body as { path?: unknown; referrer?: unknown };
  const path = textField(payload.path) || request.nextUrl.pathname;
  const novelId = novelIdFromPath(path);
  if (!novelId) {
    return new NextResponse(null, { status: 204 });
  }

  recordAnalyticsEvent({
    headers: request.headers,
    userId: getCurrentUserFromRequest(request)?.id ?? null,
    eventType: "book_view",
    path,
    referrer: textField(payload.referrer) || request.headers.get("referer"),
    novelId,
  });

  return new NextResponse(null, { status: 204 });
}
