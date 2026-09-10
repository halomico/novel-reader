import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  deletePostgresNovel,
  getPostgresAdjacentReaderNovels,
  isPostgresNovelPinned,
  listPostgresEffectivelyHiddenTagIds,
  listPostgresNovelHotwords,
  togglePostgresPinnedNovel,
} from "./postgres-reader-catalog";

function executorWithRows(rows: QueryResultRow[], captured: SqlQuery[] = [], rowCount = rows.length): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

const book = { id: 8, title: "中篇", mtimeMs: 99, sourceId: 2 };

test("reader adjacent navigation stays source-scoped with deterministic tuple order", async () => {
  const captured: SqlQuery[] = [];
  const adjacent = await getPostgresAdjacentReaderNovels(executorWithRows([
    { side: "previous", id: 9, title: "前篇", size_bytes: "1024" },
    { side: "next", id: 7, title: "后篇", size_bytes: "2048" },
  ], captured), book, "updated");
  assert.deepEqual(adjacent, {
    previous: { id: 9, title: "前篇", sizeBytes: 1024 },
    next: { id: 7, title: "后篇", sizeBytes: 2048 },
  });
  assert.deepEqual(captured[0].values, [8, 99, 2]);
  assert.match(captured[0].text, /source_id IS NOT DISTINCT FROM \$3::integer/);
  assert.match(captured[0].text, /\(n\.mtime_ms, n\.id\)/);
});

test("reader name navigation binds every parameter with an explicit type", async () => {
  const captured: SqlQuery[] = [];
  await getPostgresAdjacentReaderNovels(executorWithRows([], captured), book, "name");
  assert.deepEqual(captured[0].values, ["中篇", 8, 2]);
  assert.match(captured[0].text, /lower\(\$1::text\)/);
  assert.match(captured[0].text, /\$2::integer/);
  assert.match(captured[0].text, /source_id IS NOT DISTINCT FROM \$3::integer/);
});

test("reader decorations use PostgreSQL ordering and recursive hidden tags", async () => {
  assert.deepEqual(await listPostgresNovelHotwords(executorWithRows([{ term: "修仙" }, { term: "龙门" }]), 8), ["修仙", "龙门"]);
  assert.equal(await isPostgresNovelPinned(executorWithRows([{ pinned: true }]), 8), true);
  assert.deepEqual(await listPostgresEffectivelyHiddenTagIds(executorWithRows([{ id: "4" }, { id: "7" }]), 3), new Set([4, 7]));
  const captured: SqlQuery[] = [];
  await listPostgresEffectivelyHiddenTagIds(executorWithRows([], captured), 3);
  assert.match(captured[0].text, /WITH RECURSIVE hidden/);
});

test("reader admin mutations are atomic catalog operations", async () => {
  const toggleQueries: SqlQuery[] = [];
  assert.deepEqual(await togglePostgresPinnedNovel(executorWithRows([{ found: true, pinned: true }], toggleQueries), 8), {
    found: true,
    pinned: true,
  });
  assert.match(toggleQueries[0].text, /DELETE FROM pinned_novels[\s\S]*INSERT INTO pinned_novels/);
  assert.equal(await deletePostgresNovel(executorWithRows([], [], 1), 8), true);
  await assert.rejects(deletePostgresNovel(executorWithRows([]), -1), /delete novel id/);
});
