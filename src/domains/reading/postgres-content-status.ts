import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import type { NovelSourceSearchMode } from "@/core/config/site-settings-schema";
import { CONTENT_NORMALIZATION_VERSION } from "./content-text";

export type PostgresContentIndexState = "missing" | "pending" | "ready" | "failed";

export type PostgresContentSourceStatus = {
  sourceId: number;
  slug: string;
  name: string;
  mode: NovelSourceSearchMode;
  state: PostgresContentIndexState;
  totalBooks: number;
  indexedBooks: number;
  pendingBooks: number;
  staleBooks: number;
  failedBooks: number;
  sourceBytes: number;
  indexedBytes: number;
  lastIndexedAt: string | null;
};

export type PostgresContentIndexSummary = {
  totalBooks: number;
  indexedBooks: number;
  pendingBooks: number;
  staleBooks: number;
  failedBooks: number;
  sourceBytes: number;
  indexedBytes: number;
  databaseBytes: number;
  databaseRatio: number;
  normalizationVersion: number;
  lastIndexedAt: string | null;
};

type StatusRow = QueryResultRow & {
  source_id: number;
  slug: string;
  name: string;
  total_books: string | number;
  indexed_books: string | number;
  stale_books: string | number;
  failed_books: string | number;
  source_bytes: string | number;
  indexed_bytes: string | number;
  last_indexed_at: Date | string | null;
  database_bytes: string | number;
};

function positiveInt32(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new Error(`Invalid PostgreSQL ${label}`);
  }
  return Number(value);
}

function count(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL content index timestamp");
  return parsed.toISOString();
}

export async function readPostgresContentIndexStatus(
  executor: SqlExecutor,
  sourceModes: Readonly<Record<string, NovelSourceSearchMode>> = {},
): Promise<{ sources: PostgresContentSourceStatus[]; summary: PostgresContentIndexSummary }> {
  const result = await executor.query<StatusRow>({
    text: `WITH expected AS (
      SELECT n.id AS novel_id, n.source_id, NULL::integer AS chapter_id,
             n.content_hash, n.published_content_version
      FROM novels n WHERE n.storage_mode = 'single'
      UNION ALL
      SELECT n.id, n.source_id, c.id, c.content_hash, c.published_content_version
      FROM novels n JOIN novel_chapters c ON c.novel_id = n.id
      WHERE n.storage_mode = 'chapters'
    ), evaluated AS (
      SELECT e.novel_id,
        e.content_hash IS NOT NULL AND e.content_hash <> ''
          AND d.state = 'ready' AND d.active_generation > 0
          AND d.normalization_version = $1
          AND d.active_content_version IS NOT DISTINCT FROM e.published_content_version
          AND g.state = 'published'
          AND g.source_content_version IS NOT DISTINCT FROM e.content_hash AS ready,
        d.id IS NOT NULL AND d.state <> 'failed' AND NOT (
          d.state = 'ready' AND d.active_generation > 0
          AND d.normalization_version = $1
          AND d.active_content_version IS NOT DISTINCT FROM e.published_content_version
          AND g.state = 'published'
          AND g.source_content_version IS NOT DISTINCT FROM e.content_hash
        ) AS stale,
        d.state = 'failed' AS failed,
        d.indexed_at
      FROM expected e
      LEFT JOIN novel_documents d
        ON d.novel_id = e.novel_id AND d.chapter_id IS NOT DISTINCT FROM e.chapter_id
      LEFT JOIN novel_content_generations g
        ON g.document_id = d.id AND g.generation = d.active_generation
    ), books AS (
      SELECT novel_id, bool_and(ready) AS ready, bool_or(stale) AS stale,
             bool_or(failed) AS failed, max(indexed_at) AS indexed_at
      FROM evaluated GROUP BY novel_id
    )
    SELECT s.id AS source_id, s.slug, s.name,
      count(n.id)::text AS total_books,
      count(n.id) FILTER (WHERE coalesce(b.ready, false))::text AS indexed_books,
      count(n.id) FILTER (WHERE coalesce(b.stale, false))::text AS stale_books,
      count(n.id) FILTER (WHERE coalesce(b.failed, false))::text AS failed_books,
      coalesce(sum(n.size_bytes), 0)::text AS source_bytes,
      coalesce(sum(n.size_bytes) FILTER (WHERE coalesce(b.ready, false)), 0)::text AS indexed_bytes,
      max(b.indexed_at) AS last_indexed_at,
      (pg_total_relation_size('novel_documents'::regclass)
       + pg_total_relation_size('novel_content_generations'::regclass)
       + pg_total_relation_size('novel_content_blocks'::regclass))::text AS database_bytes
    FROM novel_sources s
    LEFT JOIN novels n ON n.source_id = s.id
    LEFT JOIN books b ON b.novel_id = n.id
    GROUP BY s.id
    ORDER BY CASE WHEN lower(s.slug) = 'default' THEN 0 ELSE 1 END,
             s.sort_order, lower(s.name) COLLATE "C", s.id`,
    values: [CONTENT_NORMALIZATION_VERSION],
  });
  let databaseBytes = 0;
  const sources = result.rows.map((row): PostgresContentSourceStatus => {
    const totalBooks = count(row.total_books, "content source book count");
    const indexedBooks = count(row.indexed_books, "indexed book count");
    const staleBooks = count(row.stale_books, "stale book count");
    const failedBooks = count(row.failed_books, "failed book count");
    const sourceBytes = count(row.source_bytes, "content source bytes");
    const indexedBytes = count(row.indexed_bytes, "indexed source bytes");
    databaseBytes = Math.max(databaseBytes, count(row.database_bytes, "content database bytes"));
    const pendingBooks = Math.max(totalBooks - indexedBooks, 0);
    const state: PostgresContentIndexState = failedBooks > 0
      ? "failed"
      : totalBooks === 0 || pendingBooks === 0
        ? "ready"
        : indexedBooks > 0
          ? "pending"
          : "missing";
    const slug = row.slug.toLocaleLowerCase("en-US");
    return {
      sourceId: positiveInt32(row.source_id, "content source id"),
      slug: row.slug,
      name: row.name,
      mode: sourceModes[slug] === "book" ? "book" : "full",
      state,
      totalBooks,
      indexedBooks,
      pendingBooks,
      staleBooks,
      failedBooks,
      sourceBytes,
      indexedBytes,
      lastIndexedAt: timestamp(row.last_indexed_at),
    };
  });
  const summary = sources.reduce<PostgresContentIndexSummary>((total, source) => ({
    totalBooks: total.totalBooks + source.totalBooks,
    indexedBooks: total.indexedBooks + source.indexedBooks,
    pendingBooks: total.pendingBooks + source.pendingBooks,
    staleBooks: total.staleBooks + source.staleBooks,
    failedBooks: total.failedBooks + source.failedBooks,
    sourceBytes: total.sourceBytes + source.sourceBytes,
    indexedBytes: total.indexedBytes + source.indexedBytes,
    databaseBytes,
    databaseRatio: 0,
    normalizationVersion: CONTENT_NORMALIZATION_VERSION,
    lastIndexedAt: !total.lastIndexedAt || (source.lastIndexedAt && source.lastIndexedAt > total.lastIndexedAt)
      ? source.lastIndexedAt
      : total.lastIndexedAt,
  }), {
    totalBooks: 0,
    indexedBooks: 0,
    pendingBooks: 0,
    staleBooks: 0,
    failedBooks: 0,
    sourceBytes: 0,
    indexedBytes: 0,
    databaseBytes,
    databaseRatio: 0,
    normalizationVersion: CONTENT_NORMALIZATION_VERSION,
    lastIndexedAt: null,
  });
  summary.databaseBytes = databaseBytes;
  summary.databaseRatio = summary.sourceBytes > 0 ? databaseBytes / summary.sourceBytes : 0;
  return { sources, summary };
}
