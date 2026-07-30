import crypto from "node:crypto";
import { getDb } from "./db";
import { getUserLevelDefinition } from "./user-levels";

const PLAYBACK_LEASE_MS = 90_000;

export type VideoPlaybackLease = {
  id: string;
  token: string;
  expiresAt: number;
};

export type VideoPlaybackLeaseResult =
  | { ok: true; lease: VideoPlaybackLease }
  | { ok: false; reason: "not_allowed" | "limit_reached" | "not_found"; limit?: number };

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function pruneExpired(now: number) {
  getDb()
    .prepare("DELETE FROM video_playback_sessions WHERE expires_at <= ? OR last_seen_at <= ?")
    .run(now, now - PLAYBACK_LEASE_MS);
}

export function getVideoConcurrencyLimit(user: {
  role: "user" | "admin";
  trustLevel: number;
}): number {
  if (user.role === "admin") return 20;
  return getUserLevelDefinition(user.trustLevel).videoConcurrencyLimit;
}

export function createVideoPlaybackLease(input: {
  userId: number;
  mediaId: number;
  limit: number;
  now?: number;
}): VideoPlaybackLeaseResult {
  const now = input.now ?? Date.now();
  const limit = Math.min(Math.max(Math.floor(input.limit), 0), 20);
  if (limit < 1) return { ok: false, reason: "not_allowed", limit };
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    pruneExpired(now);
    const media = db
      .prepare("SELECT kind FROM media_assets WHERE id = ?")
      .get(input.mediaId) as { kind: string } | undefined;
    if (media?.kind !== "video") {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const active = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM video_playback_sessions
         WHERE user_id = ? AND expires_at > ? AND last_seen_at > ?`,
      )
      .get(input.userId, now, now - PLAYBACK_LEASE_MS) as { count: number };
    if (active.count >= limit) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit_reached", limit };
    }
    const id = crypto.randomBytes(18).toString("base64url");
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now + PLAYBACK_LEASE_MS;
    db.prepare(
      `INSERT INTO video_playback_sessions (
         id, user_id, media_id, token_hash, expires_at, last_seen_at
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, input.userId, input.mediaId, tokenHash(token), expiresAt, now);
    db.exec("COMMIT");
    return { ok: true, lease: { id, token, expiresAt } };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function validateVideoPlaybackLease(input: {
  id: string;
  token: string;
  userId: number;
  mediaId: number;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const row = getDb()
    .prepare(
      `SELECT token_hash
       FROM video_playback_sessions
       WHERE id = ? AND user_id = ? AND media_id = ?
         AND expires_at > ? AND last_seen_at > ?`,
    )
    .get(input.id, input.userId, input.mediaId, now, now - PLAYBACK_LEASE_MS) as {
    token_hash: string;
  } | undefined;
  if (!row) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(tokenHash(input.token)));
  } catch {
    return false;
  }
}

export function refreshVideoPlaybackLease(input: {
  id: string;
  token: string;
  userId: number;
  mediaId: number;
  now?: number;
}): number | null {
  const now = input.now ?? Date.now();
  if (!validateVideoPlaybackLease(input)) return null;
  const expiresAt = now + PLAYBACK_LEASE_MS;
  const changed = getDb()
    .prepare(
      `UPDATE video_playback_sessions
       SET last_seen_at = ?, expires_at = ?
       WHERE id = ? AND user_id = ? AND media_id = ?`,
    )
    .run(now, expiresAt, input.id, input.userId, input.mediaId).changes;
  return changed ? expiresAt : null;
}

export function releaseVideoPlaybackLease(input: {
  id: string;
  token: string;
  userId: number;
  mediaId: number;
}): boolean {
  if (!validateVideoPlaybackLease(input)) return false;
  return getDb()
    .prepare(
      `DELETE FROM video_playback_sessions
       WHERE id = ? AND user_id = ? AND media_id = ?`,
    )
    .run(input.id, input.userId, input.mediaId).changes > 0;
}
