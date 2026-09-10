import type { QueryResultRow } from "pg";
import { requestAnalyticsMetadata } from "@/core/analytics/request-metadata";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { recordPostgresEngagementEvent, validateEngagementEventId } from "@/core/engagement/record";
import type { HeaderReader } from "@/core/security/client-ip";

export type PostgresMediaKind = "video" | "audio" | "file";

export type PostgresMediaSummary = Readonly<{
  id: number;
  kind: PostgresMediaKind;
  title: string;
}>;

export type PostgresMediaEngagementResult = Readonly<{
  accepted: boolean;
  counted: boolean;
  duplicateEvent: boolean;
}>;

type MediaRow = QueryResultRow & {
  id: string | number;
  kind: string;
  title: string;
};

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function mediaKind(value: string): PostgresMediaKind {
  if (value !== "video" && value !== "audio" && value !== "file") {
    throw new Error("Invalid PostgreSQL media kind");
  }
  return value;
}

function mediaSummary(row: MediaRow | undefined): PostgresMediaSummary | null {
  if (!row) return null;
  const id = Number(row.id);
  return { id: positiveId(id, "media id"), kind: mediaKind(row.kind), title: row.title };
}

export async function getPostgresMediaSummary(
  executor: SqlExecutor,
  mediaIdValue: number,
): Promise<PostgresMediaSummary | null> {
  const mediaId = positiveId(mediaIdValue, "media id");
  const result = await executor.query<MediaRow>({
    name: "media-summary-v1",
    text: "SELECT id, kind, title FROM media_assets WHERE id = $1",
    values: [mediaId],
  });
  return mediaSummary(result.rows[0]);
}

export async function recordPostgresMediaView(
  input: {
    eventId: unknown;
    viewerKey: string;
    media: PostgresMediaSummary;
    userId?: number | null;
    headers: HeaderReader;
    referrer?: string | null;
    analyticsEnabled?: boolean;
    dedupeWindowMs?: number;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<PostgresMediaEngagementResult> {
  const eventId = validateEngagementEventId(input.eventId);
  if (!eventId) throw new TypeError("Invalid PostgreSQL engagement event id");
  const mediaId = positiveId(input.media.id, "media id");
  const userId = input.userId == null ? null : positiveId(input.userId, "user id");
  const kind = mediaKind(input.media.kind);
  const metadata = requestAnalyticsMetadata(input.headers, input.referrer);

  return transaction(async (tx) => {
    const locked = await tx.query<MediaRow>({
      text: "SELECT id, kind, title FROM media_assets WHERE id = $1 FOR KEY SHARE",
      values: [mediaId],
    });
    const media = mediaSummary(locked.rows[0]);
    if (!media || media.kind !== kind) {
      return { accepted: false, counted: false, duplicateEvent: false };
    }

    const result = await recordPostgresEngagementEvent(tx, {
      eventId,
      viewerKey: input.viewerKey,
      contentType: media.kind,
      contentId: media.id,
      action: "detail_view",
      dedupeWindowMs: input.dedupeWindowMs,
    }, async (executor) => {
      if (userId !== null) {
        await executor.query({
          text: `INSERT INTO user_media_history
            (user_id, media_id, kind, title, visit_count, last_accessed_at)
            VALUES ($1, $2, $3, $4, 1, clock_timestamp())
            ON CONFLICT (user_id, media_id) DO UPDATE SET
              kind = EXCLUDED.kind,
              title = EXCLUDED.title,
              visit_count = user_media_history.visit_count + 1,
              last_accessed_at = clock_timestamp()`,
          values: [userId, media.id, media.kind, media.title],
        });
      }
      if (input.analyticsEnabled) {
        await executor.query({
          text: `INSERT INTO analytics_events
            (user_id, event_type, path, referrer, ip, country, user_agent, device, browser, os, media_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          values: [userId, `${media.kind}_view`, `/media/${media.id}`, metadata.referrer, metadata.ip,
            metadata.country, metadata.userAgent, metadata.device, metadata.browser, metadata.os, media.id],
        });
      }
    });

    if (userId !== null && !result.duplicateEvent) {
      await tx.query({
        text: `UPDATE user_media_grove SET visit_count = visit_count + 1
          WHERE user_id = $1 AND media_id = $2`,
        values: [userId, media.id],
      });
    }
    return result;
  });
}
