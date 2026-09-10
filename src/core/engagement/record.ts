import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";

export type EngagementContentType = "novel" | "original" | "video" | "audio" | "file";
export type EngagementAction = "detail_view" | "read_open" | "play_start";

export type EngagementEventInput = {
  eventId: string;
  viewerKey: string;
  contentType: EngagementContentType;
  contentId: number;
  action: EngagementAction;
  now?: number;
  dedupeWindowMs?: number;
};

export type EngagementRecordResult = {
  accepted: boolean;
  counted: boolean;
  duplicateEvent: boolean;
};

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/u;

export function validateEngagementEventId(value: unknown): string | null {
  const eventId = String(value || "").trim();
  return EVENT_ID_PATTERN.test(eventId) ? eventId : null;
}

export async function recordPostgresEngagementEvent(
  executor: SqlExecutor,
  input: EngagementEventInput,
  onCount: (executor: SqlExecutor) => Promise<void>,
): Promise<EngagementRecordResult> {
  const now = input.now ?? Date.now();
  const windowMs = Math.min(Math.max(input.dedupeWindowMs ?? 30 * 60_000, 10_000), 24 * 60 * 60_000);
  await executor.query({
    text: `SELECT pg_advisory_xact_lock(hashtextextended(
      concat_ws(':', $1::text, $2::text, $3::text, $4::text), 0
    ))`,
    values: [input.viewerKey, input.contentType, input.contentId, input.action],
  });
  const existing = await executor.query<QueryResultRow & { counted: boolean }>({
    text: "SELECT counted FROM engagement_events WHERE event_id = $1",
    values: [input.eventId],
  });
  if (existing.rows[0]) {
    return { accepted: true, counted: existing.rows[0].counted === true, duplicateEvent: true };
  }
  const recent = await executor.query({
    text: `SELECT 1 FROM engagement_events
      WHERE viewer_key = $1 AND content_type = $2 AND content_id = $3 AND action = $4
        AND counted = TRUE AND created_at >= $5
      LIMIT 1`,
    values: [input.viewerKey, input.contentType, input.contentId, input.action, new Date(now - windowMs)],
  });
  const counted = !recent.rowCount;
  await executor.query({
    text: `INSERT INTO engagement_events
      (event_id, viewer_key, content_type, content_id, action, counted, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    values: [input.eventId, input.viewerKey, input.contentType, input.contentId, input.action, counted, new Date(now)],
  });
  if (counted) await onCount(executor);
  return { accepted: true, counted, duplicateEvent: false };
}
