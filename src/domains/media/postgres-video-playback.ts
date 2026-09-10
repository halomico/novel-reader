import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { getPostgresUserLevelDefinition } from "@/domains/identity/postgres-permissions";

export const POSTGRES_PLAYBACK_LEASE_MS = 90_000;

export type PostgresVideoPlaybackLease = Readonly<{
  id: string;
  token: string;
  expiresAt: number;
}>;
export type PostgresVideoPlaybackLeaseResult =
  | Readonly<{ ok: true; lease: PostgresVideoPlaybackLease }>
  | Readonly<{ ok: false; reason: "not_allowed" | "limit_reached" | "node_busy" | "not_found"; limit?: number }>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cleanViewerKey(value: string): string {
  const normalized = value.trim();
  return /^(?:user:\d+|guest:[A-Za-z0-9_-]{24,80})$/u.test(normalized) ? normalized : "";
}

function cleanClientId(value: string): string {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{16,80}$/u.test(normalized) ? normalized : "";
}

function cleanNodeId(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized ? Array.from(normalized).slice(0, 64).join("") : null;
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function count(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

export function getPostgresGuestVideoConcurrencyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.GUEST_VIDEO_CONCURRENCY_LIMIT || 1);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 20) : 1;
}

export async function getPostgresVideoConcurrencyLimit(
  executor: SqlExecutor,
  user: { role: "user" | "admin"; trustLevel: number } | null,
): Promise<number> {
  if (!user) return getPostgresGuestVideoConcurrencyLimit();
  if (user.role === "admin") return 20;
  return (await getPostgresUserLevelDefinition(executor, user.trustLevel)).videoConcurrencyLimit;
}

export function estimatePostgresVideoBitrateKbps(input: { sizeBytes: number; durationSeconds: number | null }): number {
  const duration = Number(input.durationSeconds || 0);
  const calculated = duration > 0 ? (Math.max(input.sizeBytes, 0) * 8) / duration / 1_000 : 0;
  return Math.min(Math.max(Math.ceil(calculated || 2_500), 128), 100_000);
}

export async function createPostgresVideoPlaybackLease(
  input: {
    viewerKey: string;
    userId?: number | null;
    clientId: string;
    mediaId: number;
    limit: number;
    storageNodeId?: string | null;
    reservedKbps?: number;
    nodeMaxStreams?: number;
    nodeBandwidthKbps?: number;
    now?: Date;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<PostgresVideoPlaybackLeaseResult> {
  const viewerKey = cleanViewerKey(input.viewerKey);
  const clientId = cleanClientId(input.clientId);
  const limit = Math.min(Math.max(Math.floor(input.limit), 0), 20);
  if (!viewerKey || !clientId || limit < 1) return { ok: false, reason: "not_allowed", limit };
  const mediaId = positiveId(input.mediaId, "media id");
  const userId = input.userId == null ? null : positiveId(input.userId, "user id");
  const storageNodeId = cleanNodeId(input.storageNodeId);
  const nodeKey = storageNodeId || "local";
  const reservedKbps = Math.min(Math.max(Math.ceil(input.reservedKbps || 0), 0), 100_000);
  const nodeMaxStreams = Math.min(Math.max(Math.floor(input.nodeMaxStreams || 0), 0), 100_000);
  const nodeBandwidthKbps = Math.min(Math.max(Math.floor(input.nodeBandwidthKbps || 0), 0), 100_000_000);
  const now = input.now ?? new Date();

  return transaction(async (tx) => {
    // Advisory locks make quota checks and the following UPSERT one atomic
    // decision across every web replica.
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtextextended('video-viewer:' || $1, 0))",
      values: [viewerKey],
    });
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtextextended('video-node:' || $1, 0))",
      values: [nodeKey],
    });
    await tx.query({
      text: `DELETE FROM video_playback_sessions WHERE id IN (
        SELECT id FROM video_playback_sessions
        WHERE expires_at <= $1 OR last_seen_at <= $1 - ($2::integer * interval '1 millisecond')
        ORDER BY expires_at, id LIMIT 64
      )`,
      values: [now, POSTGRES_PLAYBACK_LEASE_MS],
    });
    const media = await tx.query<QueryResultRow & { found: boolean }>({
      text: `SELECT EXISTS (
        SELECT 1 FROM media_assets WHERE id = $1 AND kind = 'video'
      ) AS found`,
      values: [mediaId],
    });
    if (media.rows[0]?.found !== true) return { ok: false, reason: "not_found" };

    const existing = await tx.query<QueryResultRow & { id: string }>({
      text: "SELECT id FROM video_playback_sessions WHERE viewer_key = $1 AND client_id = $2",
      values: [viewerKey, clientId],
    });
    const existingId = existing.rows[0]?.id ?? "";
    const active = await tx.query<QueryResultRow & { active: string | number }>({
      text: `SELECT COUNT(*)::bigint AS active FROM video_playback_sessions
        WHERE viewer_key = $1 AND id <> $2 AND expires_at > $3
          AND last_seen_at > $3 - ($4::integer * interval '1 millisecond')`,
      values: [viewerKey, existingId, now, POSTGRES_PLAYBACK_LEASE_MS],
    });
    if (count(active.rows[0]?.active ?? 0, "active playback leases") >= limit) {
      return { ok: false, reason: "limit_reached", limit };
    }
    if (nodeMaxStreams > 0 || nodeBandwidthKbps > 0) {
      const usage = await tx.query<QueryResultRow & { streams: string | number; kbps: string | number }>({
        text: `SELECT COUNT(*)::bigint AS streams, COALESCE(SUM(reserved_kbps), 0)::bigint AS kbps
          FROM video_playback_sessions
          WHERE COALESCE(storage_node_id, 'local') = $1 AND id <> $2
            AND expires_at > $3 AND last_seen_at > $3 - ($4::integer * interval '1 millisecond')`,
        values: [nodeKey, existingId, now, POSTGRES_PLAYBACK_LEASE_MS],
      });
      const streams = count(usage.rows[0]?.streams ?? 0, "node playback streams");
      const kbps = count(usage.rows[0]?.kbps ?? 0, "node playback bandwidth");
      if ((nodeMaxStreams > 0 && streams >= nodeMaxStreams) ||
          (nodeBandwidthKbps > 0 && kbps + reservedKbps > nodeBandwidthKbps)) {
        return { ok: false, reason: "node_busy" };
      }
    }

    const id = existingId || crypto.randomBytes(18).toString("base64url");
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + POSTGRES_PLAYBACK_LEASE_MS);
    await tx.query({
      text: `INSERT INTO video_playback_sessions
        (id, viewer_key, user_id, client_id, media_id, storage_node_id, reserved_kbps, token_hash, expires_at, last_seen_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (viewer_key, client_id) DO UPDATE SET
          user_id = EXCLUDED.user_id, media_id = EXCLUDED.media_id,
          storage_node_id = EXCLUDED.storage_node_id, reserved_kbps = EXCLUDED.reserved_kbps,
          token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
          last_seen_at = EXCLUDED.last_seen_at`,
      values: [id, viewerKey, userId, clientId, mediaId, storageNodeId, reservedKbps, tokenHash(token), expiresAt, now],
    });
    return { ok: true, lease: { id, token, expiresAt: expiresAt.getTime() } };
  });
}

function validLeaseInput(input: { id: string; token: string; viewerKey: string; mediaId: number }) {
  const id = input.id.trim();
  const token = input.token.trim();
  const viewerKey = cleanViewerKey(input.viewerKey);
  if (!/^[A-Za-z0-9_-]{16,80}$/u.test(id) || !/^[A-Za-z0-9_-]{32,128}$/u.test(token) || !viewerKey) return null;
  return { id, tokenHash: tokenHash(token), viewerKey, mediaId: positiveId(input.mediaId, "media id") };
}

export async function validatePostgresVideoPlaybackLease(executor: SqlExecutor, input: {
  id: string; token: string; viewerKey: string; mediaId: number; now?: Date;
}): Promise<boolean> {
  const valid = validLeaseInput(input);
  if (!valid) return false;
  const now = input.now ?? new Date();
  const result = await executor.query<QueryResultRow & { valid: boolean }>({
    text: `SELECT EXISTS (
      SELECT 1 FROM video_playback_sessions
      WHERE id = $1 AND token_hash = $2 AND viewer_key = $3 AND media_id = $4
        AND expires_at > $5 AND last_seen_at > $5 - ($6::integer * interval '1 millisecond')
    ) AS valid`,
    values: [valid.id, valid.tokenHash, valid.viewerKey, valid.mediaId, now, POSTGRES_PLAYBACK_LEASE_MS],
  });
  return result.rows[0]?.valid === true;
}

export async function refreshPostgresVideoPlaybackLease(executor: SqlExecutor, input: {
  id: string; token: string; viewerKey: string; mediaId: number; now?: Date;
}): Promise<number | null> {
  const valid = validLeaseInput(input);
  if (!valid) return null;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + POSTGRES_PLAYBACK_LEASE_MS);
  const result = await executor.query<QueryResultRow & { expires_at: Date | string }>({
    text: `UPDATE video_playback_sessions
      SET last_seen_at = $5, expires_at = $6
      WHERE id = $1 AND token_hash = $2 AND viewer_key = $3 AND media_id = $4
        AND expires_at > $5 AND last_seen_at > $5 - ($7::integer * interval '1 millisecond')
      RETURNING expires_at`,
    values: [valid.id, valid.tokenHash, valid.viewerKey, valid.mediaId, now, expiresAt, POSTGRES_PLAYBACK_LEASE_MS],
  });
  return result.rows[0] ? new Date(result.rows[0].expires_at).getTime() : null;
}

export async function releasePostgresVideoPlaybackLease(executor: SqlExecutor, input: {
  id: string; token: string; viewerKey: string; mediaId: number;
}): Promise<boolean> {
  const valid = validLeaseInput(input);
  if (!valid) return false;
  const result = await executor.query({
    text: `DELETE FROM video_playback_sessions
      WHERE id = $1 AND token_hash = $2 AND viewer_key = $3 AND media_id = $4`,
    values: [valid.id, valid.tokenHash, valid.viewerKey, valid.mediaId],
  });
  return result.rowCount === 1;
}
