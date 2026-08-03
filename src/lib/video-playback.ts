import crypto from "node:crypto";
import { getDb } from "./db";
import { getUserLevelDefinition } from "./user-levels";

export const PLAYBACK_LEASE_MS = 90_000;

export type VideoPlaybackLease = {
  id: string;
  token: string;
  expiresAt: number;
};

export type VideoPlaybackLeaseResult =
  | { ok: true; lease: VideoPlaybackLease }
  | {
      ok: false;
      reason: "not_allowed" | "limit_reached" | "node_busy" | "not_found";
      limit?: number;
    };

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cleanViewerKey(value: string): string {
  const normalized = value.trim();
  return /^(?:user:\d+|guest:[A-Za-z0-9_-]{24,80})$/.test(normalized) ? normalized : "";
}

function cleanClientId(value: string): string {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{16,80}$/.test(normalized) ? normalized : "";
}

function cleanNodeId(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 64) : null;
}

function pruneExpired(now: number) {
  getDb()
    .prepare("DELETE FROM video_playback_sessions WHERE expires_at <= ? OR last_seen_at <= ?")
    .run(now, now - PLAYBACK_LEASE_MS);
}

export function getGuestVideoConcurrencyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.GUEST_VIDEO_CONCURRENCY_LIMIT || 1);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 20) : 1;
}

export function getVideoConcurrencyLimit(user: {
  role: "user" | "admin";
  trustLevel: number;
} | null): number {
  if (!user) return getGuestVideoConcurrencyLimit();
  if (user.role === "admin") return 20;
  return getUserLevelDefinition(user.trustLevel).videoConcurrencyLimit;
}

export function estimateVideoBitrateKbps(input: {
  sizeBytes: number;
  durationSeconds: number | null;
}): number {
  const duration = Number(input.durationSeconds || 0);
  const calculated = duration > 0 ? (Math.max(input.sizeBytes, 0) * 8) / duration / 1_000 : 0;
  return Math.min(Math.max(Math.ceil(calculated || 2_500), 128), 100_000);
}

export function createVideoPlaybackLease(input: {
  viewerKey: string;
  userId?: number | null;
  clientId: string;
  mediaId: number;
  limit: number;
  storageNodeId?: string | null;
  reservedKbps?: number;
  nodeMaxStreams?: number;
  nodeBandwidthKbps?: number;
  now?: number;
}): VideoPlaybackLeaseResult {
  const now = input.now ?? Date.now();
  const viewerKey = cleanViewerKey(input.viewerKey);
  const clientId = cleanClientId(input.clientId);
  const limit = Math.min(Math.max(Math.floor(input.limit), 0), 20);
  if (!viewerKey || !clientId || limit < 1) return { ok: false, reason: "not_allowed", limit };

  const storageNodeId = cleanNodeId(input.storageNodeId);
  const nodeKey = storageNodeId || "local";
  const reservedKbps = Math.min(Math.max(Math.ceil(input.reservedKbps || 0), 0), 100_000);
  const nodeMaxStreams = Math.min(Math.max(Math.floor(input.nodeMaxStreams || 0), 0), 100_000);
  const nodeBandwidthKbps = Math.min(Math.max(Math.floor(input.nodeBandwidthKbps || 0), 0), 100_000_000);
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

    const existing = db
      .prepare("SELECT id FROM video_playback_sessions WHERE viewer_key = ? AND client_id = ?")
      .get(viewerKey, clientId) as { id: string } | undefined;
    const existingId = existing?.id || "";
    const active = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM video_playback_sessions
         WHERE viewer_key = ? AND id <> ? AND expires_at > ? AND last_seen_at > ?`,
      )
      .get(viewerKey, existingId, now, now - PLAYBACK_LEASE_MS) as { count: number };
    if (active.count >= limit) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit_reached", limit };
    }

    if (nodeMaxStreams > 0 || nodeBandwidthKbps > 0) {
      const nodeUsage = db
        .prepare(
          `SELECT COUNT(*) AS streams, COALESCE(SUM(reserved_kbps), 0) AS kbps
           FROM video_playback_sessions
           WHERE COALESCE(storage_node_id, 'local') = ? AND id <> ?
             AND expires_at > ? AND last_seen_at > ?`,
        )
        .get(nodeKey, existingId, now, now - PLAYBACK_LEASE_MS) as { streams: number; kbps: number };
      if (
        (nodeMaxStreams > 0 && nodeUsage.streams >= nodeMaxStreams) ||
        (nodeBandwidthKbps > 0 && nodeUsage.kbps + reservedKbps > nodeBandwidthKbps)
      ) {
        db.exec("ROLLBACK");
        return { ok: false, reason: "node_busy" };
      }
    }

    const id = existing?.id || crypto.randomBytes(18).toString("base64url");
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now + PLAYBACK_LEASE_MS;
    if (existing) {
      db.prepare(
        `UPDATE video_playback_sessions
         SET user_id = ?, media_id = ?, storage_node_id = ?, reserved_kbps = ?,
             token_hash = ?, expires_at = ?, last_seen_at = ?
         WHERE id = ?`,
      ).run(
        input.userId || null,
        input.mediaId,
        storageNodeId,
        reservedKbps,
        tokenHash(token),
        expiresAt,
        now,
        id,
      );
    } else {
      db.prepare(
        `INSERT INTO video_playback_sessions (
           id, viewer_key, user_id, client_id, media_id, storage_node_id,
           reserved_kbps, token_hash, expires_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        viewerKey,
        input.userId || null,
        clientId,
        input.mediaId,
        storageNodeId,
        reservedKbps,
        tokenHash(token),
        expiresAt,
        now,
      );
    }
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
  viewerKey: string;
  mediaId: number;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const viewerKey = cleanViewerKey(input.viewerKey);
  if (!viewerKey) return false;
  const row = getDb()
    .prepare(
      `SELECT token_hash
       FROM video_playback_sessions
       WHERE id = ? AND viewer_key = ? AND media_id = ?
         AND expires_at > ? AND last_seen_at > ?`,
    )
    .get(input.id, viewerKey, input.mediaId, now, now - PLAYBACK_LEASE_MS) as {
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
  viewerKey: string;
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
       WHERE id = ? AND viewer_key = ? AND media_id = ?`,
    )
    .run(now, expiresAt, input.id, input.viewerKey, input.mediaId).changes;
  return changed ? expiresAt : null;
}

export function releaseVideoPlaybackLease(input: {
  id: string;
  token: string;
  viewerKey: string;
  mediaId: number;
}): boolean {
  if (!validateVideoPlaybackLease(input)) return false;
  return getDb()
    .prepare(
      `DELETE FROM video_playback_sessions
       WHERE id = ? AND viewer_key = ? AND media_id = ?`,
    )
    .run(input.id, input.viewerKey, input.mediaId).changes > 0;
}
