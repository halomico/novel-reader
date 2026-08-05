import crypto from "node:crypto";
import { getDb } from "./db";
import { hasMediaAssetEntitlement } from "./entitlements";
import type { MediaAsset } from "./media";

export const VIDEO_SODA_UNLOCK_MS = 24 * 60 * 60 * 1_000;
export const VIDEO_DOWNLOAD_TICKET_MS = 6 * 60 * 60 * 1_000;
export const VIDEO_DOWNLOAD_SESSION_MS = 30 * 60 * 1_000;

export type VideoPlaybackAccess = {
  allowed: boolean;
  price: number;
  expiresAt: number | null;
  reason: "free" | "admin" | "granted" | "login_required" | "unlock_required";
};

export function getVideoPlaybackAccess(
  asset: Pick<MediaAsset, "id" | "kind" | "categoryId" | "folder" | "playSodaPrice">,
  user: { id: number; role: "user" | "admin" } | null,
  now = Date.now(),
): VideoPlaybackAccess {
  const price = Math.max(Math.floor(asset.playSodaPrice || 0), 0);
  if (asset.kind !== "video" || price === 0) {
    return { allowed: true, price: 0, expiresAt: null, reason: "free" };
  }
  if (user?.role === "admin") {
    return { allowed: true, price, expiresAt: null, reason: "admin" };
  }
  if (!user) {
    return { allowed: false, price, expiresAt: null, reason: "login_required" };
  }
  if (hasMediaAssetEntitlement(user.id, asset, "play")) {
    return { allowed: true, price, expiresAt: null, reason: "granted" };
  }
  const grant = getDb()
    .prepare(
      `SELECT expires_at
       FROM media_playback_grants
       WHERE user_id = ? AND media_id = ? AND expires_at > ?`,
    )
    .get(user.id, asset.id, now) as { expires_at: number } | undefined;
  return grant
    ? { allowed: true, price, expiresAt: grant.expires_at, reason: "granted" }
    : { allowed: false, price, expiresAt: null, reason: "unlock_required" };
}

export type VideoUnlockResult =
  | { ok: true; charged: boolean; sodaBalance: number; expiresAt: number | null }
  | { ok: false; reason: "not_found" | "account_unavailable" | "insufficient_soda" };

export function unlockVideoWithSoda(input: {
  userId: number;
  mediaId: number;
  now?: number;
}): VideoUnlockResult {
  const now = input.now ?? Date.now();
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const asset = db
      .prepare("SELECT id, kind, category_id, stored_name, play_soda_price FROM media_assets WHERE id = ?")
      .get(input.mediaId) as {
        id: number;
        kind: "video";
        category_id: number | null;
        stored_name: string;
        play_soda_price: number;
      } | undefined;
    if (!asset || asset.kind !== "video") {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const user = db
      .prepare("SELECT status, soda_balance, role FROM users WHERE id = ?")
      .get(input.userId) as { status: string; soda_balance: number; role: string } | undefined;
    if (!user || user.status !== "active") {
      db.exec("ROLLBACK");
      return { ok: false, reason: "account_unavailable" };
    }
    const price = Math.max(Math.floor(asset.play_soda_price || 0), 0);
    if (price === 0 || user.role === "admin" || hasMediaAssetEntitlement(input.userId, {
      id: asset.id,
      kind: "video",
      categoryId: asset.category_id,
      folder: "",
    }, "play")) {
      db.exec("COMMIT");
      return { ok: true, charged: false, sodaBalance: user.soda_balance, expiresAt: null };
    }
    const existing = db
      .prepare(
        `SELECT expires_at
         FROM media_playback_grants
         WHERE user_id = ? AND media_id = ? AND expires_at > ?`,
      )
      .get(input.userId, input.mediaId, now) as { expires_at: number } | undefined;
    if (existing) {
      db.exec("COMMIT");
      return {
        ok: true,
        charged: false,
        sodaBalance: user.soda_balance,
        expiresAt: existing.expires_at,
      };
    }
    if (user.soda_balance < price) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient_soda" };
    }

    const sodaBalance = user.soda_balance - price;
    const expiresAt = now + VIDEO_SODA_UNLOCK_MS;
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(sodaBalance, input.userId);
    db.prepare(
      `INSERT INTO media_playback_grants (user_id, media_id, soda_spent, granted_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, media_id) DO UPDATE SET
         soda_spent = excluded.soda_spent,
         granted_at = excluded.granted_at,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(input.userId, input.mediaId, price, now, expiresAt);
    db.prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       ) VALUES (?, 'soda', ?, ?, 'video_unlock', ?, '视频 24 小时播放授权')`,
    ).run(
      input.userId,
      -price,
      sodaBalance,
      `video-unlock:${input.userId}:${input.mediaId}:${expiresAt}`,
    );
    db.exec("COMMIT");
    return { ok: true, charged: true, sodaBalance, expiresAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type VideoDownloadAccess = {
  allowed: boolean;
  expiresAt: number | null;
  reason: "admin" | "entitlement" | "ticket" | "required";
};

export function getVideoDownloadAccess(
  asset: Pick<MediaAsset, "id" | "kind" | "categoryId" | "folder">,
  user: { id: number; role: "user" | "admin" } | null,
  now = Date.now(),
): VideoDownloadAccess {
  if (!user || asset.kind !== "video") {
    return { allowed: false, expiresAt: null, reason: "required" };
  }
  if (user.role === "admin") {
    return { allowed: true, expiresAt: null, reason: "admin" };
  }
  if (hasMediaAssetEntitlement(user.id, asset, "download")) {
    return { allowed: true, expiresAt: null, reason: "entitlement" };
  }
  const grant = getDb().prepare(
    `SELECT expires_at
     FROM media_download_grants
     WHERE user_id = ? AND media_id = ? AND expires_at > ?`,
  ).get(user.id, asset.id, now) as { expires_at: number } | undefined;
  return grant
    ? { allowed: true, expiresAt: grant.expires_at, reason: "ticket" }
    : { allowed: false, expiresAt: null, reason: "required" };
}

function downloadSessionTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hasValidVideoDownloadSession(input: {
  userId: number;
  mediaId: number;
  token: string;
  now?: number;
}): boolean {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(input.token)) return false;
  return Boolean(getDb().prepare(
    `SELECT 1 AS found
     FROM media_download_sessions
     WHERE token_hash = ? AND user_id = ? AND media_id = ? AND expires_at > ?`,
  ).get(
    downloadSessionTokenHash(input.token),
    input.userId,
    input.mediaId,
    input.now ?? Date.now(),
  ));
}

export type VideoDownloadUnlockResult =
  | {
      ok: true;
      charged: boolean;
      sodaBalance: number;
      ticketExpiresAt: number | null;
      sessionExpiresAt: number;
      sessionToken: string;
    }
  | { ok: false; reason: "not_found" | "account_unavailable" | "insufficient_soda" | "daily_limit" };

export function unlockVideoDownloadWithSoda(input: {
  userId: number;
  mediaId: number;
  now?: number;
}): VideoDownloadUnlockResult {
  const now = input.now ?? Date.now();
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const asset = db
      .prepare("SELECT id, kind, category_id, download_soda_price FROM media_assets WHERE id = ?")
      .get(input.mediaId) as {
        id: number;
        kind: "video";
        category_id: number | null;
        download_soda_price: number;
      } | undefined;
    if (!asset || asset.kind !== "video") {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const user = db.prepare(
      `SELECT u.status, u.soda_balance, u.role,
              COALESCE(l.daily_video_download_limit, 0) AS daily_video_download_limit
       FROM users u
       LEFT JOIN user_levels l ON l.level = u.trust_level
       WHERE u.id = ?`,
    ).get(input.userId) as {
      status: string;
      soda_balance: number;
      role: string;
      daily_video_download_limit: number;
    } | undefined;
    if (!user || user.status !== "active") {
      db.exec("ROLLBACK");
      return { ok: false, reason: "account_unavailable" };
    }
    const entitlementAsset = {
      id: asset.id,
      kind: "video" as const,
      categoryId: asset.category_id,
      folder: "",
    };
    const permanentAccess = user.role === "admin" || hasMediaAssetEntitlement(input.userId, entitlementAsset, "download");
    const existing = permanentAccess ? undefined : db.prepare(
      `SELECT expires_at
       FROM media_download_grants
       WHERE user_id = ? AND media_id = ? AND expires_at > ?`,
    ).get(input.userId, input.mediaId, now) as { expires_at: number } | undefined;
    if (user.role !== "admin") {
      const dailyLimit = Math.min(Math.max(Math.floor(user.daily_video_download_limit || 0), 0), 1_000);
      const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
      const used = (db.prepare(
        `SELECT COUNT(*) AS count
         FROM media_download_sessions
         WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
      ).get(input.userId, dayStart, dayStart + 86_400_000) as { count: number }).count;
      if (used >= dailyLimit) {
        db.exec("ROLLBACK");
        return { ok: false, reason: "daily_limit" };
      }
    }
    const price = permanentAccess || existing ? 0 : Math.max(Math.floor(asset.download_soda_price ?? 1), 0);
    if (user.soda_balance < price) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient_soda" };
    }
    const sodaBalance = user.soda_balance - price;
    if (price > 0) {
      db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(sodaBalance, input.userId);
    }
    const ticketExpiresAt = permanentAccess
      ? null
      : existing?.expires_at ?? now + VIDEO_DOWNLOAD_TICKET_MS;
    if (!permanentAccess && !existing) {
      db.prepare(
        `INSERT INTO media_download_grants (user_id, media_id, soda_spent, granted_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, media_id) DO UPDATE SET
           soda_spent = excluded.soda_spent,
           granted_at = excluded.granted_at,
           expires_at = excluded.expires_at,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(input.userId, input.mediaId, price, now, ticketExpiresAt);
      if (price > 0) {
        db.prepare(
          `INSERT INTO user_currency_transactions (
             user_id, currency, amount, balance_after, source, reference_key, note
           ) VALUES (?, 'soda', ?, ?, 'video_download', ?, '视频 6 小时下载票据')`,
        ).run(
          input.userId,
          -price,
          sodaBalance,
          `video-download:${input.userId}:${input.mediaId}:${ticketExpiresAt}`,
        );
      }
    }
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const sessionExpiresAt = now + VIDEO_DOWNLOAD_SESSION_MS;
    db.prepare(
      `INSERT INTO media_download_sessions (token_hash, user_id, media_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(downloadSessionTokenHash(sessionToken), input.userId, input.mediaId, now, sessionExpiresAt);
    db.prepare("DELETE FROM media_download_sessions WHERE created_at < ?")
      .run(now - 8 * 86_400_000);
    db.exec("COMMIT");
    return {
      ok: true,
      charged: price > 0,
      sodaBalance,
      ticketExpiresAt,
      sessionExpiresAt,
      sessionToken,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
