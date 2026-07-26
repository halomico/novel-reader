import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/user-auth";
import { listDailyCheckinLeaderboard } from "@/lib/user-economy";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "请先登录" }, { status: 401 });
  }

  const response = NextResponse.json({ entries: listDailyCheckinLeaderboard() });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
