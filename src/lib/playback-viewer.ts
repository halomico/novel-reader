import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const PLAYBACK_VIEWER_COOKIE = "novel_media_viewer";
const VIEWER_COOKIE_SECONDS = 30 * 24 * 60 * 60;

function validGuestId(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9_-]{32,80}$/.test(value) ? value : null;
}

export function playbackViewerFromRequest(
  request: NextRequest,
  userId: number | null,
  createGuest = false,
): { viewerKey: string; guestId: string | null; created: boolean } | null {
  if (userId && Number.isInteger(userId) && userId > 0) {
    return { viewerKey: `user:${userId}`, guestId: null, created: false };
  }
  const existing = validGuestId(request.cookies.get(PLAYBACK_VIEWER_COOKIE)?.value);
  if (existing) return { viewerKey: `guest:${existing}`, guestId: existing, created: false };
  if (!createGuest) return null;
  const guestId = crypto.randomBytes(24).toString("base64url");
  return { viewerKey: `guest:${guestId}`, guestId, created: true };
}

export function attachPlaybackViewerCookie(
  response: NextResponse,
  viewer: { guestId: string | null; created: boolean },
) {
  if (!viewer.created || !viewer.guestId) return;
  response.cookies.set(PLAYBACK_VIEWER_COOKIE, viewer.guestId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VIEWER_COOKIE_SECONDS,
  });
}
