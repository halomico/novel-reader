import { NextRequest, NextResponse } from "next/server";
import { createPostgresTelegramLinkUrl } from "@/domains/notifications/postgres-telegram-links";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  const headers = { "Cache-Control": "private, no-store" };
  if (!user) return NextResponse.redirect(new URL("/login", request.url), { headers });
  const url = await createPostgresTelegramLinkUrl(user.id);
  if (!url) {
    const fallback = new URL("/messages", request.url);
    fallback.searchParams.set("tab", "station");
    fallback.searchParams.set("notice", "Telegram 尚未配置");
    fallback.searchParams.set("tone", "warning");
    return NextResponse.redirect(fallback, { headers });
  }
  return NextResponse.redirect(url, { headers });
}
