import type { DatabaseSync } from "node:sqlite";

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

export function recordEngagementEvent(
  db: DatabaseSync,
  input: EngagementEventInput,
  onCount: (db: DatabaseSync) => void,
): EngagementRecordResult {
  const now = input.now ?? Date.now();
  const windowMs = Math.min(Math.max(input.dedupeWindowMs ?? 30 * 60_000, 10_000), 24 * 60 * 60_000);
  const existing = db.prepare(
    "SELECT counted FROM engagement_events WHERE event_id = ?",
  ).get(input.eventId) as { counted: number } | undefined;
  if (existing) {
    return { accepted: true, counted: existing.counted === 1, duplicateEvent: true };
  }

  const recent = db.prepare(
    `SELECT 1 AS found
     FROM engagement_events
     WHERE viewer_key = ? AND content_type = ? AND content_id = ? AND action = ?
       AND counted = 1 AND created_at >= ?
     LIMIT 1`,
  ).get(
    input.viewerKey,
    input.contentType,
    input.contentId,
    input.action,
    now - windowMs,
  );
  const counted = !recent;
  db.prepare(
    `INSERT INTO engagement_events (
       event_id, viewer_key, content_type, content_id, action, counted, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.eventId,
    input.viewerKey,
    input.contentType,
    input.contentId,
    input.action,
    counted ? 1 : 0,
    now,
  );
  if (counted) onCount(db);
  return { accepted: true, counted, duplicateEvent: false };
}

export function pruneEngagementEvents(db: DatabaseSync, before: number): number {
  return Number(db.prepare("DELETE FROM engagement_events WHERE created_at < ?").run(before).changes);
}
