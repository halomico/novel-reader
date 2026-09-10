import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import { parseSimpleAndSearchQuery } from "@/lib/search-query";

export type SearchQueryMode = "title" | "content";
export type SearchQuerySource = "direct" | "header_title" | "header_content" | "reader_current" | "reader_hotword" | "advanced_tags";

const SOURCES = new Set<SearchQuerySource>([
  "direct", "header_title", "header_content", "reader_current", "reader_hotword", "advanced_tags",
]);
const EVENT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type EventKeyRow = QueryResultRow & { event_key: string };

export function normalizePostgresSearchAnalyticsQuery(value: string): string {
  return Array.from(value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase())
    .slice(0, 200).join("");
}

export function normalizePostgresSearchQuerySource(value: string | null | undefined): SearchQuerySource {
  return SOURCES.has(value as SearchQuerySource) ? value as SearchQuerySource : "direct";
}

function validEventKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return EVENT_KEY_PATTERN.test(key) ? key : null;
}

function optionalPositiveId(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function optionalResultCount(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.floor(Number(value)), 0), 1_000_000);
}

export async function recordPostgresSearchQuery(
  executor: SqlExecutor,
  queryValue: string,
  mode: SearchQueryMode,
  options: {
    source?: string | null;
    userId?: number | null;
    originNovelId?: number | null;
    resultCount?: number | null;
    resultNovelCount?: number | null;
  } = {},
): Promise<string | null> {
  if (mode !== "title" && mode !== "content") throw new Error("Invalid search analytics mode");
  const query = normalizePostgresSearchAnalyticsQuery(queryValue);
  if (!query) return null;
  const parsed = parseSimpleAndSearchQuery(query, { mode });
  const terms = parsed.ok ? parsed.query.requiredTerms.map((term) => term.value) : query.split(" ").filter(Boolean).slice(0, 12);
  const eventKey = randomUUID();
  const result = await executor.query<EventKeyRow>({
    text: `WITH inserted_event AS MATERIALIZED (
             INSERT INTO search_query_events (
               event_key, query, mode, source, user_id, origin_novel_id,
               result_count, result_novel_count
             )
             VALUES (
               $1, $2, $3, $4,
               CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = $5) THEN $5 ELSE NULL END,
               CASE WHEN EXISTS (SELECT 1 FROM novels WHERE id = $6) THEN $6 ELSE NULL END,
               $7, $8
             )
             RETURNING id, event_key
           ), inserted_terms AS (
             INSERT INTO search_query_terms (search_event_id, term, position)
             SELECT inserted_event.id, input.term, input.position - 1
             FROM inserted_event
             CROSS JOIN unnest($9::text[]) WITH ORDINALITY AS input(term, position)
             RETURNING search_event_id
           )
           SELECT event_key FROM inserted_event`,
    values: [
      eventKey,
      query,
      mode,
      normalizePostgresSearchQuerySource(options.source),
      optionalPositiveId(options.userId),
      optionalPositiveId(options.originNovelId),
      optionalResultCount(options.resultCount),
      optionalResultCount(options.resultNovelCount),
      terms,
    ],
  });
  return result.rows[0]?.event_key ?? null;
}

export async function resolvePostgresSearchEventKey(
  executor: SqlExecutor,
  eventKeyValue: string | null | undefined,
  queryValue: string,
): Promise<string | null> {
  const eventKey = validEventKey(eventKeyValue);
  const query = normalizePostgresSearchAnalyticsQuery(queryValue);
  if (!eventKey || !query) return null;
  const result = await executor.query<EventKeyRow>({
    text: `SELECT event_key FROM search_query_events
           WHERE event_key = $1 AND query = $2
           LIMIT 1`,
    values: [eventKey, query],
  });
  return result.rows[0]?.event_key ?? null;
}

export async function updatePostgresSearchQueryResults(
  executor: SqlExecutor,
  eventKeyValue: string,
  resultCountValue: number,
  resultNovelCountValue: number,
): Promise<boolean> {
  const eventKey = validEventKey(eventKeyValue);
  const resultCount = optionalResultCount(resultCountValue);
  const resultNovelCount = optionalResultCount(resultNovelCountValue);
  if (!eventKey || resultCount === null || resultNovelCount === null) return false;
  const result = await executor.query({
    text: `UPDATE search_query_events
           SET result_count = $2, result_novel_count = $3
           WHERE event_key = $1`,
    values: [eventKey, resultCount, resultNovelCount],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function recordPostgresSearchResultClick(
  executor: SqlExecutor,
  eventKeyValue: string,
  novelIdValue: number,
  segmentIndexValue?: number | null,
): Promise<boolean> {
  const eventKey = validEventKey(eventKeyValue);
  const novelId = optionalPositiveId(novelIdValue);
  const segmentIndex = Number.isSafeInteger(segmentIndexValue) && Number(segmentIndexValue) >= 0
    ? Number(segmentIndexValue)
    : null;
  if (!eventKey || novelId === null) return false;
  const result = await executor.query({
    text: `INSERT INTO search_result_clicks (search_event_id, novel_id, segment_index)
           SELECT event.id, novel.id, $3
           FROM search_query_events event
           JOIN novels novel ON novel.id = $2
           WHERE event.event_key = $1`,
    values: [eventKey, novelId, segmentIndex],
  });
  return (result.rowCount ?? 0) > 0;
}
