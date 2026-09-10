import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import type { PostgresPublicNovel } from "@/domains/catalog/postgres-catalog";
import type { ReaderAdjacentNovelSort } from "@/core/config/site-settings-schema";

type AdjacentReaderNovelRow = QueryResultRow & {
  id: number;
  title: string;
  size_bytes: string | number;
};

export type PostgresAdjacentReaderNovel = {
  id: number;
  title: string;
  sizeBytes: number;
};

function positiveInt32(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function safeCount(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${name}`);
  return parsed;
}

export async function getPostgresAdjacentReaderNovels(
  executor: SqlExecutor,
  book: Pick<PostgresPublicNovel, "id" | "title" | "mtimeMs" | "sourceId">,
  sortBy: ReaderAdjacentNovelSort,
): Promise<{ previous: PostgresAdjacentReaderNovel | null; next: PostgresAdjacentReaderNovel | null }> {
  const novelId = positiveInt32(book.id, "reader novel id");
  if (sortBy !== "name" && sortBy !== "updated") throw new Error("Invalid adjacent novel sort");
  if (book.sourceId !== null) positiveInt32(book.sourceId, "reader novel source id");
  const nameSort = sortBy === "name";
  const result = await executor.query<AdjacentReaderNovelRow & { side: "previous" | "next" }>({
    name: nameSort ? "reading-adjacent-novels-name-v1" : "reading-adjacent-novels-updated-v1",
    text: nameSort
      ? `SELECT side, id, title, size_bytes FROM (
          (SELECT 'previous'::text AS side, n.id, n.title, n.size_bytes
           FROM novels n
           WHERE n.source_id IS NOT DISTINCT FROM $3::integer
             AND (lower(n.title) COLLATE "C", n.id) < (lower($1::text) COLLATE "C", $2::integer)
           ORDER BY lower(n.title) COLLATE "C" DESC, n.id DESC LIMIT 1)
          UNION ALL
          (SELECT 'next'::text AS side, n.id, n.title, n.size_bytes
           FROM novels n
           WHERE n.source_id IS NOT DISTINCT FROM $3::integer
             AND (lower(n.title) COLLATE "C", n.id) > (lower($1::text) COLLATE "C", $2::integer)
           ORDER BY lower(n.title) COLLATE "C" ASC, n.id ASC LIMIT 1)
        ) adjacent`
      : `SELECT side, id, title, size_bytes FROM (
          (SELECT 'previous'::text AS side, n.id, n.title, n.size_bytes
           FROM novels n
           WHERE n.source_id IS NOT DISTINCT FROM $3::integer
             AND (n.mtime_ms, n.id) > ($2::bigint, $1::integer)
           ORDER BY n.mtime_ms ASC, n.id ASC LIMIT 1)
          UNION ALL
          (SELECT 'next'::text AS side, n.id, n.title, n.size_bytes
           FROM novels n
           WHERE n.source_id IS NOT DISTINCT FROM $3::integer
             AND (n.mtime_ms, n.id) < ($2::bigint, $1::integer)
           ORDER BY n.mtime_ms DESC, n.id DESC LIMIT 1)
        ) adjacent`,
    values: nameSort ? [book.title, novelId, book.sourceId] : [novelId, book.mtimeMs, book.sourceId],
  });
  const map = (row: AdjacentReaderNovelRow | undefined): PostgresAdjacentReaderNovel | null => row ? ({
    id: positiveInt32(row.id, "adjacent novel id"),
    title: row.title,
    sizeBytes: safeCount(row.size_bytes, "adjacent novel size"),
  }) : null;
  return {
    previous: map(result.rows.find((row) => row.side === "previous")),
    next: map(result.rows.find((row) => row.side === "next")),
  };
}

export async function listPostgresNovelHotwords(executor: SqlExecutor, novelIdValue: number): Promise<string[]> {
  const result = await executor.query<QueryResultRow & { term: string }>({
    name: "reading-novel-hotwords-v1",
    text: `SELECT term FROM novel_hotwords WHERE novel_id = $1
      ORDER BY sort_order ASC, lower(term) COLLATE "C" ASC, term COLLATE "C" ASC`,
    values: [positiveInt32(novelIdValue, "hotword novel id")],
  });
  return result.rows.map((row) => row.term);
}

export async function isPostgresNovelPinned(executor: SqlExecutor, novelIdValue: number): Promise<boolean> {
  const result = await executor.query<QueryResultRow & { pinned: boolean }>({
    name: "reading-is-novel-pinned-v1",
    text: "SELECT EXISTS (SELECT 1 FROM pinned_novels WHERE novel_id = $1) AS pinned",
    values: [positiveInt32(novelIdValue, "pinned novel id")],
  });
  return result.rows[0]?.pinned === true;
}

export async function listPostgresEffectivelyHiddenTagIds(
  executor: SqlExecutor,
  userIdValue: number | null | undefined,
): Promise<Set<number>> {
  if (userIdValue === null || userIdValue === undefined) return new Set();
  const userId = positiveInt32(userIdValue, "tag preference user id");
  const result = await executor.query<QueryResultRow & { id: string | number }>({
    name: "reading-effective-hidden-tags-v1",
    text: `WITH RECURSIVE hidden(id) AS (
        SELECT tag_id FROM user_hidden_tags WHERE user_id = $1
        UNION
        SELECT tag.id FROM tags tag INNER JOIN hidden parent ON tag.parent_id = parent.id
      ) SELECT id FROM hidden ORDER BY id`,
    values: [userId],
  });
  return new Set(result.rows.map((row) => safeCount(row.id, "hidden tag id")));
}

export async function togglePostgresPinnedNovel(
  executor: SqlExecutor,
  novelIdValue: number,
): Promise<{ found: boolean; pinned: boolean }> {
  const result = await executor.query<QueryResultRow & { found: boolean; pinned: boolean }>({
    text: `WITH target AS (
        SELECT id FROM novels WHERE id = $1
      ), removed AS (
        DELETE FROM pinned_novels WHERE novel_id = $1 RETURNING novel_id
      ), inserted AS (
        INSERT INTO pinned_novels (novel_id, sort_order)
        SELECT target.id, coalesce((SELECT max(sort_order) + 10 FROM pinned_novels), 10)
        FROM target WHERE NOT EXISTS (SELECT 1 FROM removed)
        ON CONFLICT (novel_id) DO NOTHING RETURNING novel_id
      )
      SELECT EXISTS (SELECT 1 FROM target) AS found,
             EXISTS (SELECT 1 FROM inserted) AS pinned`,
    values: [positiveInt32(novelIdValue, "toggle pinned novel id")],
  });
  return result.rows[0] ?? { found: false, pinned: false };
}

export async function deletePostgresNovel(executor: SqlExecutor, novelIdValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM novels WHERE id = $1",
    values: [positiveInt32(novelIdValue, "delete novel id")],
  });
  return result.rowCount === 1;
}
