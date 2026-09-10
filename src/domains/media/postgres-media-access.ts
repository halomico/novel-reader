import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";

export const POSTGRES_VIDEO_SODA_UNLOCK_MS = 24 * 60 * 60 * 1_000;
export const POSTGRES_VIDEO_DOWNLOAD_TICKET_MS = 6 * 60 * 60 * 1_000;
export const POSTGRES_VIDEO_DOWNLOAD_SESSION_MS = 30 * 60 * 1_000;

export type PostgresVideoPlaybackAccess = Readonly<{
  allowed: boolean;
  price: number;
  expiresAt: number | null;
  reason: "free" | "admin" | "granted" | "login_required" | "unlock_required";
}>;
export type PostgresVideoUnlockResult =
  | Readonly<{ ok: true; charged: boolean; sodaBalance: number; expiresAt: number | null }>
  | Readonly<{ ok: false; reason: "not_found" | "account_unavailable" | "insufficient_soda" }>;
export type PostgresVideoDownloadAccess = Readonly<{
  allowed: boolean;
  expiresAt: number | null;
  reason: "admin" | "entitlement" | "ticket" | "required";
}>;
export type PostgresVideoDownloadUnlockResult =
  | Readonly<{
      ok: true;
      charged: boolean;
      sodaBalance: number;
      ticketExpiresAt: number | null;
      sessionExpiresAt: number;
      sessionToken: string;
    }>
  | Readonly<{ ok: false; reason: "not_found" | "account_unavailable" | "insufficient_soda" | "daily_limit" }>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type VideoRow = QueryResultRow & {
  id: string | number;
  category_id: string | number | null;
  play_soda_price: string | number;
};
type UserRow = QueryResultRow & { status: string; role: string; soda_balance: string | number };
type DownloadUserRow = UserRow & { daily_video_download_limit: string | number };

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function amount(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

async function hasVideoEntitlement(executor: SqlExecutor, userId: number, mediaId: number, categoryId: number | null, right: "play" | "download"): Promise<boolean> {
  const result = await executor.query<QueryResultRow & { allowed: boolean }>({
    text: `SELECT EXISTS (
      SELECT 1 FROM user_entitlements entitlement
      WHERE entitlement.user_id = $1
        AND (entitlement.expires_at IS NULL OR entitlement.expires_at > clock_timestamp())
        AND entitlement.rights ? $4
        AND (
          (entitlement.resource_type = 'video' AND entitlement.resource_id = $2::text)
          OR ($3::bigint IS NOT NULL AND entitlement.resource_type = 'video_category' AND entitlement.resource_id = $3::text)
          OR (entitlement.resource_type = 'video_tag' AND EXISTS (
            SELECT 1 FROM media_asset_tags relation
            WHERE relation.media_id = $2::bigint AND relation.tag_id::text = entitlement.resource_id
          ))
        )
    ) AS allowed`,
    values: [userId, mediaId, categoryId, right],
  });
  return result.rows[0]?.allowed === true;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function getPostgresVideoPlaybackAccess(
  executor: SqlExecutor,
  mediaIdValue: number,
  user: { id: number; role: "user" | "admin" } | null,
  now = new Date(),
): Promise<PostgresVideoPlaybackAccess | null> {
  const mediaId = positiveId(mediaIdValue, "media id");
  const assets = await executor.query<VideoRow>({
    text: "SELECT id, category_id, play_soda_price FROM media_assets WHERE id = $1 AND kind = 'video'",
    values: [mediaId],
  });
  const asset = assets.rows[0];
  if (!asset) return null;
  const price = amount(asset.play_soda_price, "video play price");
  if (price === 0) return { allowed: true, price: 0, expiresAt: null, reason: "free" };
  if (user?.role === "admin") return { allowed: true, price, expiresAt: null, reason: "admin" };
  if (!user) return { allowed: false, price, expiresAt: null, reason: "login_required" };
  const categoryId = asset.category_id === null ? null : positiveId(Number(asset.category_id), "video category id");
  if (await hasVideoEntitlement(executor, positiveId(user.id, "user id"), mediaId, categoryId, "play")) {
    return { allowed: true, price, expiresAt: null, reason: "granted" };
  }
  const grants = await executor.query<QueryResultRow & { expires_at: Date | string }>({
    text: `SELECT expires_at FROM media_playback_grants
      WHERE user_id = $1 AND media_id = $2 AND expires_at > $3`,
    values: [user.id, mediaId, now],
  });
  const expires = grants.rows[0]?.expires_at;
  return expires
    ? { allowed: true, price, expiresAt: new Date(expires).getTime(), reason: "granted" }
    : { allowed: false, price, expiresAt: null, reason: "unlock_required" };
}

export async function unlockPostgresVideoWithSoda(
  input: { userId: number; mediaId: number; now?: Date },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<PostgresVideoUnlockResult> {
  const userId = positiveId(input.userId, "user id");
  const mediaId = positiveId(input.mediaId, "media id");
  const now = input.now ?? new Date();
  return transaction(async (tx) => {
    const users = await tx.query<UserRow>({
      text: "SELECT status, role, soda_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      values: [userId],
    });
    const user = users.rows[0];
    if (!user || user.status !== "active") return { ok: false, reason: "account_unavailable" };
    const assets = await tx.query<VideoRow>({
      text: "SELECT id, category_id, play_soda_price FROM media_assets WHERE id = $1 AND kind = 'video' FOR KEY SHARE",
      values: [mediaId],
    });
    const asset = assets.rows[0];
    if (!asset) return { ok: false, reason: "not_found" };
    const balance = amount(user.soda_balance, "soda balance");
    const price = amount(asset.play_soda_price, "video play price");
    const categoryId = asset.category_id === null ? null : positiveId(Number(asset.category_id), "video category id");
    if (price === 0 || user.role === "admin" || await hasVideoEntitlement(tx, userId, mediaId, categoryId, "play")) {
      return { ok: true, charged: false, sodaBalance: balance, expiresAt: null };
    }
    const grants = await tx.query<QueryResultRow & { expires_at: Date | string }>({
      text: `SELECT expires_at FROM media_playback_grants
        WHERE user_id = $1 AND media_id = $2 AND expires_at > $3 FOR UPDATE`,
      values: [userId, mediaId, now],
    });
    if (grants.rows[0]) {
      return { ok: true, charged: false, sodaBalance: balance, expiresAt: new Date(grants.rows[0].expires_at).getTime() };
    }
    if (balance < price) return { ok: false, reason: "insufficient_soda" };
    const nextBalance = balance - price;
    const expiresAt = new Date(now.getTime() + POSTGRES_VIDEO_SODA_UNLOCK_MS);
    const charged = await tx.query({
      text: `UPDATE users SET soda_balance = soda_balance - $2, updated_at = clock_timestamp()
        WHERE id = $1 AND soda_balance >= $2`,
      values: [userId, price],
    });
    if (charged.rowCount !== 1) return { ok: false, reason: "insufficient_soda" };
    await tx.query({
      text: `INSERT INTO media_playback_grants (user_id, media_id, soda_spent, granted_at, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, media_id) DO UPDATE SET
          soda_spent = EXCLUDED.soda_spent, granted_at = EXCLUDED.granted_at,
          expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()`,
      values: [userId, mediaId, price, now, expiresAt],
    });
    await tx.query({
      text: `INSERT INTO user_currency_transactions
        (user_id, currency, amount, balance_after, source, reference_key, note)
        VALUES ($1, 'soda', $2, $3, 'video_unlock', $4, '视频 24 小时播放授权')`,
      values: [userId, -price, nextBalance, `video-unlock:${userId}:${mediaId}:${expiresAt.getTime()}`],
    });
    return { ok: true, charged: true, sodaBalance: nextBalance, expiresAt: expiresAt.getTime() };
  });
}

export async function getPostgresVideoDownloadAccess(
  executor: SqlExecutor,
  mediaIdValue: number,
  user: { id: number; role: "user" | "admin" } | null,
  now = new Date(),
): Promise<PostgresVideoDownloadAccess | null> {
  const mediaId = positiveId(mediaIdValue, "media id");
  const assets = await executor.query<VideoRow>({
    text: "SELECT id, category_id, play_soda_price FROM media_assets WHERE id = $1 AND kind = 'video'",
    values: [mediaId],
  });
  const asset = assets.rows[0];
  if (!asset) return null;
  if (!user) return { allowed: false, expiresAt: null, reason: "required" };
  if (user.role === "admin") return { allowed: true, expiresAt: null, reason: "admin" };
  const userId = positiveId(user.id, "user id");
  const categoryId = asset.category_id === null ? null : positiveId(Number(asset.category_id), "video category id");
  if (await hasVideoEntitlement(executor, userId, mediaId, categoryId, "download")) {
    return { allowed: true, expiresAt: null, reason: "entitlement" };
  }
  const grants = await executor.query<QueryResultRow & { expires_at: Date | string }>({
    text: `SELECT expires_at FROM media_download_grants
      WHERE user_id = $1 AND media_id = $2 AND expires_at > $3`,
    values: [userId, mediaId, now],
  });
  const expiresAt = grants.rows[0]?.expires_at;
  return expiresAt
    ? { allowed: true, expiresAt: new Date(expiresAt).getTime(), reason: "ticket" }
    : { allowed: false, expiresAt: null, reason: "required" };
}

export async function hasValidPostgresVideoDownloadSession(executor: SqlExecutor, input: {
  userId: number;
  mediaId: number;
  token: string;
  now?: Date;
}): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(input.token)) return false;
  const result = await executor.query<QueryResultRow & { valid: boolean }>({
    text: `SELECT EXISTS (
      SELECT 1 FROM media_download_sessions
      WHERE token_hash = $1 AND user_id = $2 AND media_id = $3 AND expires_at > $4
    ) AS valid`,
    values: [tokenHash(input.token), positiveId(input.userId, "user id"), positiveId(input.mediaId, "media id"), input.now ?? new Date()],
  });
  return result.rows[0]?.valid === true;
}

export async function unlockPostgresVideoDownloadWithSoda(
  input: { userId: number; mediaId: number; now?: Date },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<PostgresVideoDownloadUnlockResult> {
  const userId = positiveId(input.userId, "user id");
  const mediaId = positiveId(input.mediaId, "media id");
  const now = input.now ?? new Date();
  return transaction(async (tx) => {
    // The account row is the serialization point for the balance, ticket, and
    // daily quota, so concurrent clicks can never double-charge or over-issue.
    const users = await tx.query<DownloadUserRow>({
      text: `SELECT account.status, account.role, account.soda_balance,
        COALESCE(level.daily_video_download_limit, 0) AS daily_video_download_limit
        FROM users account
        LEFT JOIN user_levels level ON level.level = account.trust_level
        WHERE account.id = $1 AND account.deleted_at IS NULL FOR UPDATE OF account`,
      values: [userId],
    });
    const user = users.rows[0];
    if (!user || user.status !== "active") return { ok: false, reason: "account_unavailable" };
    await tx.query({
      text: `DELETE FROM media_download_sessions WHERE token_hash IN (
        SELECT token_hash FROM media_download_sessions
        WHERE expires_at < $1 - interval '8 days'
        ORDER BY expires_at LIMIT 64
      )`,
      values: [now],
    });
    const assets = await tx.query<VideoRow & { download_soda_price: string | number }>({
      text: `SELECT id, category_id, play_soda_price, download_soda_price
        FROM media_assets WHERE id = $1 AND kind = 'video' FOR KEY SHARE`,
      values: [mediaId],
    });
    const asset = assets.rows[0];
    if (!asset) return { ok: false, reason: "not_found" };
    const balance = amount(user.soda_balance, "soda balance");
    const categoryId = asset.category_id === null ? null : positiveId(Number(asset.category_id), "video category id");
    const permanentAccess = user.role === "admin" || await hasVideoEntitlement(tx, userId, mediaId, categoryId, "download");
    const existing = permanentAccess ? undefined : (await tx.query<QueryResultRow & { expires_at: Date | string }>({
      text: `SELECT expires_at FROM media_download_grants
        WHERE user_id = $1 AND media_id = $2 AND expires_at > $3 FOR UPDATE`,
      values: [userId, mediaId, now],
    })).rows[0];

    if (user.role !== "admin") {
      const dailyLimit = Math.min(amount(user.daily_video_download_limit, "daily video download limit"), 1_000);
      const usage = await tx.query<QueryResultRow & { used: string | number }>({
        text: `SELECT COUNT(*)::bigint AS used FROM media_download_sessions
          WHERE user_id = $1
            AND created_at >= date_trunc('day', $2::timestamptz AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
            AND created_at < (date_trunc('day', $2::timestamptz AT TIME ZONE 'Asia/Shanghai') + interval '1 day') AT TIME ZONE 'Asia/Shanghai'`,
        values: [userId, now],
      });
      if (amount(usage.rows[0]?.used ?? 0, "daily download usage") >= dailyLimit) {
        return { ok: false, reason: "daily_limit" };
      }
    }

    const price = permanentAccess || existing ? 0 : amount(asset.download_soda_price, "video download price");
    if (balance < price) return { ok: false, reason: "insufficient_soda" };
    const sodaBalance = balance - price;
    if (price > 0) {
      const charged = await tx.query({
        text: `UPDATE users SET soda_balance = soda_balance - $2, updated_at = clock_timestamp()
          WHERE id = $1 AND soda_balance >= $2`,
        values: [userId, price],
      });
      if (charged.rowCount !== 1) return { ok: false, reason: "insufficient_soda" };
    }
    const ticketExpiresAt = permanentAccess
      ? null
      : existing
        ? new Date(existing.expires_at)
        : new Date(now.getTime() + POSTGRES_VIDEO_DOWNLOAD_TICKET_MS);
    if (!permanentAccess && !existing) {
      await tx.query({
        text: `INSERT INTO media_download_grants (user_id, media_id, soda_spent, granted_at, expires_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (user_id, media_id) DO UPDATE SET
            soda_spent = EXCLUDED.soda_spent, granted_at = EXCLUDED.granted_at,
            expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()`,
        values: [userId, mediaId, price, now, ticketExpiresAt],
      });
      if (price > 0) {
        await tx.query({
          text: `INSERT INTO user_currency_transactions
            (user_id, currency, amount, balance_after, source, reference_key, note)
            VALUES ($1, 'soda', $2, $3, 'video_download', $4, '视频 6 小时下载票据')`,
          values: [userId, -price, sodaBalance, `video-download:${userId}:${mediaId}:${ticketExpiresAt!.getTime()}`],
        });
      }
    }
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const sessionExpiresAt = new Date(now.getTime() + POSTGRES_VIDEO_DOWNLOAD_SESSION_MS);
    await tx.query({
      text: `INSERT INTO media_download_sessions (token_hash, user_id, media_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5)`,
      values: [tokenHash(sessionToken), userId, mediaId, now, sessionExpiresAt],
    });
    return {
      ok: true,
      charged: price > 0,
      sodaBalance,
      ticketExpiresAt: ticketExpiresAt?.getTime() ?? null,
      sessionExpiresAt: sessionExpiresAt.getTime(),
      sessionToken,
    };
  });
}
