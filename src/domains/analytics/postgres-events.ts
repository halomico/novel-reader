import type { SqlExecutor } from "@/core/db/postgres";
import { requestAnalyticsMetadata, type RequestAnalyticsMetadata } from "@/core/analytics/request-metadata";

function boundedText(value: string, maximum: number, name: string): string {
  if (!value.isWellFormed() || value.includes("\0")) throw new Error(`Invalid analytics ${name}`);
  return Array.from(value.trim()).slice(0, maximum).join("");
}

function optionalId(value: number | null | undefined, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid analytics ${name}`);
  return value;
}

function eventPath(value: string): string {
  const bounded = boundedText(value, 320, "path");
  if (!bounded) return "/";
  if (!/^https?:\/\//iu.test(bounded)) return bounded.startsWith("/") ? bounded : `/${bounded}`;
  try {
    const url = new URL(bounded);
    return boundedText(`${url.pathname}${url.search}`, 320, "path") || "/";
  } catch {
    return "/";
  }
}

export async function recordPostgresAnalyticsEvent(
  executor: SqlExecutor,
  input: {
    headers: { get(name: string): string | null };
    userId?: number | null;
    eventType?: string;
    path: string;
    referrer?: string | null;
    novelId?: number | null;
    mediaId?: number | null;
    tagId?: number | null;
  },
): Promise<void> {
  const metadata: RequestAnalyticsMetadata = requestAnalyticsMetadata(input.headers, input.referrer);
  const eventType = boundedText(input.eventType || "book_view", 48, "event type") || "book_view";
  await executor.query({
    text: `INSERT INTO analytics_events
      (user_id, event_type, path, referrer, ip, country, user_agent, device, browser, os, novel_id, media_id, tag_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    values: [
      optionalId(input.userId, "user id"),
      eventType,
      eventPath(input.path),
      metadata.referrer,
      metadata.ip,
      metadata.country,
      metadata.userAgent,
      metadata.device,
      metadata.browser,
      metadata.os,
      optionalId(input.novelId, "novel id"),
      optionalId(input.mediaId, "media id"),
      optionalId(input.tagId, "tag id"),
    ],
  });
}
