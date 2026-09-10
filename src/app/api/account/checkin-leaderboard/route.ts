import { NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { listPostgresDailyCheckinLeaderboard } from "@/domains/identity/postgres-user-economy";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "请先登录" }, { status: 401 });
  }

  const response = NextResponse.json({ entries: await listPostgresDailyCheckinLeaderboard(database("web")) });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
