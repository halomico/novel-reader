import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  buildPostgresCatalogPageQuery,
  buildPostgresChapterPageQuery,
  countPostgresCatalog,
  getPostgresChapterContext,
  getPostgresNovelSourceById,
  getPostgresPublicNovel,
  listPostgresCatalogPage,
  listPostgresNovelChapters,
  listPostgresRandomCatalog,
  listPostgresTagsForNovels,
  resolvePostgresNovelLibraryScope,
} from "./postgres-catalog";

function executorWithRows(rows: QueryResultRow[], captured: SqlQuery[] = []): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return {
        command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows,
      } as unknown as QueryResult<Row>;
    },
  };
}

const rawNovel = (id: number, sortValue = String(id)) => ({
  id, title: `小说${id}`, description: "", source_id: 2,
  storage_mode: "chapters", chapter_count: 8, access_mode: "inherit",
  soda_price: 0, preview_chapter_count: 1, published_content_version: "v1",
  size_bytes: "2048", mtime_ms: "1700000000000", word_count: 100,
  visit_count: "9", created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z", sort_value: sortValue,
});

const rawChapter = (id: number, sortOrder: number) => ({
  id, novel_id: 7, title: `第${id}章`, sort_order: sortOrder,
  page_sort_order: sortOrder, published_content_version: "cv1",
  size_bytes: "200", mtime_ms: "1700000000000", word_count: 99,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
});

test("catalog keeps the keyset fast path and supports a bound numeric page offset", async () => {
  const firstQuery = buildPostgresCatalogPageQuery({ limit: 2, sortBy: "updated", sourceId: 4, access: "free" });
  assert.match(firstQuery.text, /ORDER BY n\.mtime_ms DESC, n\.id DESC/);
  assert.match(firstQuery.text, /n\.source_id = \$1/);
  assert.doesNotMatch(firstQuery.text, /OFFSET|relative_path|file_name|content_hash|last_accessed_ip|last_accessed_user_agent/);

  const captured: SqlQuery[] = [];
  const page = await listPostgresCatalogPage(executorWithRows([
    rawNovel(3, "30"), rawNovel(2, "20"), rawNovel(1, "10"),
  ], captured), { limit: 2, sortBy: "updated" });
  assert.deepEqual(page.items.map((item) => item.id), [3, 2]);
  assert.deepEqual(page.nextCursor, { sortBy: "updated", sortOrder: "desc", sortValue: "20", id: 2 });
  assert.equal("relative_path" in page.items[0], false);

  const nextQuery = buildPostgresCatalogPageQuery({ limit: 2, sortBy: "updated", cursor: page.nextCursor! });
  assert.match(nextQuery.text, /\(n\.mtime_ms, n\.id\) < \(\$1::bigint, \$2::integer\)/);
  assert.deepEqual(nextQuery.values, ["20", 2, 3]);

  const numberedPage = buildPostgresCatalogPageQuery({ limit: 20, offset: 3_980, sortBy: "updated" });
  assert.match(numberedPage.text, /LIMIT \$1::integer OFFSET \$2::integer/u);
  assert.deepEqual(numberedPage.values, [21, 3_980]);
  assert.doesNotMatch(numberedPage.text, /relative_path|file_name|content_hash|last_accessed_ip|last_accessed_user_agent/);
});

test("catalog validates filters and rejects a cursor reused with another ordering", () => {
  assert.throws(() => buildPostgresCatalogPageQuery({ limit: 0 }), /page limit/);
  assert.throws(() => buildPostgresCatalogPageQuery({ sourceId: Number.NaN }), /source id/);
  assert.throws(() => buildPostgresCatalogPageQuery({ offset: -1 }), /offset/);
  assert.throws(() => buildPostgresCatalogPageQuery({ offset: 20, cursor: { sortBy: "updated", sortOrder: "desc", sortValue: "10", id: 1 } }), /cannot be combined/);
  assert.throws(() => buildPostgresCatalogPageQuery({
    sortBy: "name",
    cursor: { sortBy: "updated", sortOrder: "desc", sortValue: "10", id: 1 },
  }), /does not match/);
  const byName = buildPostgresCatalogPageQuery({
    sortBy: "name", sortOrder: "asc",
    cursor: { sortBy: "name", sortOrder: "asc", sortValue: "修仙", id: 9 },
  });
  assert.match(byName.text, /lower\(n\.title\) COLLATE "C"/);
  assert.doesNotMatch(byName.text, /修仙/);
});

test("catalog counts use a distinct prepared statement for every SQL shape", async () => {
  const captured: SqlQuery[] = [];
  const executor = executorWithRows([{ total: "8" }], captured);
  await countPostgresCatalog(executor);
  await countPostgresCatalog(executor, { sourceId: 4, access: "free" });
  await countPostgresCatalog(executor, { sourceId: null, access: "soda" });
  assert.deepEqual(captured.map((query) => query.name), [
    "catalog-count-v2-all-all",
    "catalog-count-v2-source-free",
    "catalog-count-v2-unassigned-soda",
  ]);
  assert.equal(new Set(captured.map((query) => query.name)).size, captured.length);
  assert.match(captured[1].text, /source_id = \$1/);
  assert.match(captured[2].text, /source_id IS NULL/);
});

test("random catalog samples uniformly over rows and names each SQL shape", async () => {
  const captured: SqlQuery[] = [];
  const executor = executorWithRows([], captured);
  await listPostgresRandomCatalog(executor, "first", { sourceId: 4, access: "free", limit: 8 });
  await listPostgresRandomCatalog(executor, "second", { sourceId: null, access: "soda", limit: 8 });

  assert.deepEqual(captured.map((query) => query.name), [
    "catalog-random-v4-source-free",
    "catalog-random-v4-unassigned-soda",
  ]);
  // Sampling the id column is the bug this replaced: sparse, unevenly clustered ids made
  // the draw proportional to the gaps between books instead of to the books.
  assert.doesNotMatch(captured[0].text, /MIN\(n\.id\)|MAX\(n\.id\)/);
  assert.match(captured[0].text, /n\.random_key >= pivot\.key/);
  assert.match(captured[0].text, /n\.random_key < pivot\.key/, "the wraparound branch keeps a high pivot from starving");
  assert.match(captured[0].text, /LEAST\(\$3::integer \* 8, 200\)/);
  assert.match(captured[0].text, /ORDER BY hashtextextended\(id::text, \$1::bigint\)/);
  // The filters ride along on both candidate branches now that there is no bounds scan.
  assert.match(captured[0].text, /n\.random_key >= pivot\.key AND n\.source_id = \$2 AND \(n\.access_mode <> 'soda' OR n\.soda_price <= 0\)/);
  assert.match(captured[0].text, /n\.random_key < pivot\.key AND n\.source_id = \$2 AND \(n\.access_mode <> 'soda' OR n\.soda_price <= 0\)/);
  assert.match(captured[1].text, /n\.random_key >= pivot\.key AND n\.source_id IS NULL AND n\.access_mode = 'soda' AND n\.soda_price > 0/);
  assert.equal(new Set(captured.map((query) => query.name)).size, captured.length);
});

test("single-novel lookup maps bigint and timestamps while retaining only its public DTO", async () => {
  const captured: SqlQuery[] = [];
  const novel = await getPostgresPublicNovel(executorWithRows([rawNovel(5)], captured), 5);
  assert.equal(novel?.sizeBytes, 2048);
  assert.equal(novel?.updatedAt, "2026-09-02T00:00:00.000Z");
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].values, [5]);
  assert.doesNotMatch(captured[0].text, /relative_path|last_accessed/);
  await assert.rejects(getPostgresPublicNovel(executorWithRows([]), 0), /novel id/);
});

test("chapter pages use effective order and a bounded compound cursor", async () => {
  const query = buildPostgresChapterPageQuery(7, { limit: 2, cursor: { sortOrder: 10, id: 8 } });
  assert.match(query.text, /COALESCE\(c\.sort_override, c\.sort_order\), c\.id\) > \(\$2, \$3\)/);
  assert.doesNotMatch(query.text, /relative_path|content_hash|OFFSET/);
  assert.deepEqual(query.values, [7, 10, 8, 3]);

  const page = await listPostgresNovelChapters(executorWithRows([
    rawChapter(1, 0), rawChapter(2, 10), rawChapter(3, 20),
  ]), 7, { limit: 2 });
  assert.deepEqual(page.items.map((item) => item.id), [1, 2]);
  assert.deepEqual(page.nextCursor, { sortOrder: 10, id: 2 });
});

test("chapter context returns current, neighbours and position in one round trip", async () => {
  const captured: SqlQuery[] = [];
  const current = rawChapter(2, 10);
  const context = await getPostgresChapterContext(executorWithRows([{
    ...current, position: "2", total: "3",
    previous_id: 1, previous_novel_id: 7, previous_title: "第一章", previous_sort_order: 0,
    previous_published_content_version: "cv1", previous_size_bytes: "100",
    previous_mtime_ms: "1700000000000", previous_word_count: 50,
    previous_created_at: current.created_at, previous_updated_at: current.updated_at,
    next_id: 3, next_novel_id: 7, next_title: "第三章", next_sort_order: 20,
    next_published_content_version: "cv1", next_size_bytes: "300",
    next_mtime_ms: "1700000000000", next_word_count: 120,
    next_created_at: current.created_at, next_updated_at: current.updated_at,
  }], captured), 7, 2);
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /WITH current AS \(/);
  assert.match(captured[0].text, /previous AS \(/);
  assert.match(captured[0].text, /next AS \(/);
  assert.doesNotMatch(captured[0].text, /LAG\(|LEAD\(|ROW_NUMBER\(\)|COUNT\(\*\) OVER/);
  assert.deepEqual({ id: context?.chapter.id, previous: context?.previous?.id, next: context?.next?.id },
    { id: 2, previous: 1, next: 3 });
  assert.deepEqual({ index: context?.index, total: context?.total }, { index: 1, total: 3 });
});

test("tag display is one ordered batch query, enforces audience, and includes empty requested novels", async () => {
  const captured: SqlQuery[] = [];
  const tags = await listPostgresTagsForNovels(executorWithRows([{
    novel_id: 2, id: "11", parent_id: null, name: "奇幻", slug: "fantasy",
    description: "", aliases: ["玄幻"], sort_order: 1, visibility: "public",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  }], captured), [2, 3, 2], { audience: "member" });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].values, [[2, 3]]);
  assert.match(captured[0].text, /unnest\(\$1::integer\[\]\).*WITH ORDINALITY/s);
  assert.match(captured[0].text, /IN \('public', 'member'\)/);
  assert.deepEqual(tags.get(2)?.map((tag) => tag.name), ["奇幻"]);
  assert.deepEqual(tags.get(3), []);
  await assert.rejects(listPostgresTagsForNovels(executorWithRows([]), [1], { audience: "invalid" as "public" }), /audience/);
});

test("library resolution uses one PostgreSQL query and preserves requested fallback priority", async () => {
  const captured: SqlQuery[] = [];
  const source = await resolvePostgresNovelLibraryScope(executorWithRows([{
    id: 3, slug: "default", name: "默认", sort_order: 0,
    novel_count: "8", single_novel_count: "5", chapter_novel_count: "3",
  }], captured), "missing", "configured");
  assert.equal(source.kind, "source");
  assert.equal(source.slug, "default");
  assert.deepEqual(captured[0].values, [["missing", "configured", "default"]]);
  assert.match(captured[0].text, /array_position\(\$1::text\[\], lower\(s\.slug\)\)/);
  assert.deepEqual(await resolvePostgresNovelLibraryScope(executorWithRows([]), "all"), {
    kind: "all", slug: "all", source: null,
  });
});

test("source lookup by id is parameterized and rejects invalid identifiers", async () => {
  const captured: SqlQuery[] = [];
  const source = await getPostgresNovelSourceById(executorWithRows([{
    id: 2, slug: "books", name: "书库", sort_order: 1,
    novel_count: "4", single_novel_count: "2", chapter_novel_count: "2",
  }], captured), 2);
  assert.equal(source?.slug, "books");
  assert.deepEqual(captured[0].values, [2]);
  await assert.rejects(getPostgresNovelSourceById(executorWithRows([]), 0), /source id/);
});
