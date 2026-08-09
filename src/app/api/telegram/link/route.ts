import { NextRequest, NextResponse } from "next/server";
import { createTelegramLinkUrl } from "@/lib/telegram-links";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const url = createTelegramLinkUrl(user.id);
  if (!url) {
    const fallback = new URL("/messages", request.url);
    fallback.searchParams.set("tab", "station");
    fallback.searchParams.set("notice", "Telegram 尚未配置");
    fallback.searchParams.set("tone", "warning");
    return NextResponse.redirect(fallback);
  }
  return NextResponse.redirect(url);
}
