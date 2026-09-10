import { type NextRequest, NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { getPostgresEntryDrawerAnnouncement } from "@/domains/station/postgres-station";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  const announcement = await getPostgresEntryDrawerAnnouncement(database("web"), Boolean(user));
  const notice = announcement
    ? {
        title: announcement.title,
        markdown: announcement.body,
        version: announcement.entryVersion || `announcement-${announcement.id}`,
      }
    : null;

  return NextResponse.json(
    { notice },
    {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    },
  );
}
