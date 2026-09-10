import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  getPostgresReadingProgress,
  hidePostgresReadingProgress,
  isCurrentPostgresReadingContentVersion,
  listPostgresReadingProgressPage,
  updatePostgresReadingProgress,
} from "./postgres-reading-progress";

const progressRow = (overrides: QueryResultRow = {}) => ({
  id: "11", novel_id: 7, chapter_id: null, title: "测试小说", segment_index: 3,
  segment_ratio: 0.25, progress_percent: 10, content_version: "sha256:v1",
  completed: false, visit_count: "2", client_saved_at_ms: "1000",
  last_read_at: "2026-09-08T00:00:00.000Z", ...overrides,
});

function executorQueue(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const response = responses.shift() ?? {};
      const rows = response.rows ?? [];
      return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

function transactionWith(executor: SqlExecutor) {
  return async <T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> => operation(executor);
}

test("PostgreSQL reading progress maps bigint and timestamps without storage data", async () => {
  const captured: SqlQuery[] = [];
  const progress = await getPostgresReadingProgress(executorQueue([{ rows: [progressRow()] }], captured), 4, 7);
  assert.deepEqual(progress, {
    historyId: 11, novelId: 7, chapterId: null, title: "测试小说", segmentIndex: 3,
    segmentRatio: 0.25, progressPercent: 10, contentVersion: "sha256:v1", completed: false,
    visitCount: 2, lastReadAt: "2026-09-08T00:00:00.000Z",
  });
  assert.deepEqual(captured[0].values, [4, 7]);
  assert.doesNotMatch(captured[0].text, /relative_path|content_hash/u);
});

test("reading revisions validate source or published PostgreSQL catalog facts without exposing hashes", async () => {
  const captured: SqlQuery[] = [];
  assert.equal(await isCurrentPostgresReadingContentVersion(
    executorQueue([{ rows: [{ current: true }] }], captured), 7, 9, "a".repeat(64),
  ), true);
  assert.deepEqual(captured[0].values, [7, 9, "a".repeat(64)]);
  assert.match(captured[0].text, /content_hash[\s\S]*published_content_version/u);
});

test("PostgreSQL progress rejects a stale browser flush before any write", async () => {
  const captured: SqlQuery[] = [];
  const result = await updatePostgresReadingProgress({
    userId: 4, novelId: 7, title: "测试小说", contentVersion: "sha256:v1",
    segmentIndex: 8, segmentRatio: 0.5, progressPercent: 30, completed: false, savedAt: 1_000,
  }, transactionWith(executorQueue([{ rows: [progressRow({ client_saved_at_ms: "2000" })] }], captured)));
  assert.equal(result.saved, false);
  assert.equal(result.progress?.segmentIndex, 3);
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /FOR UPDATE/u);
});

test("PostgreSQL progress and daily aggregates commit in one transaction", async () => {
  const captured: SqlQuery[] = [];
  const result = await updatePostgresReadingProgress({
    userId: 4, novelId: 7, chapterId: 9, title: "测试小说", contentVersion: "sha256:v2",
    segmentIndex: 8, segmentRatio: 0.5, progressPercent: 99, completed: true, savedAt: 3_000,
  }, transactionWith(executorQueue([
    { rows: [progressRow()] },
    { rows: [progressRow({ chapter_id: 9, segment_index: 8, segment_ratio: 0.5,
      progress_percent: 99, content_version: "sha256:v2", completed: true, client_saved_at_ms: "3000" })] },
    { rowCount: 1 }, { rowCount: 1 },
  ], captured)));
  assert.equal(result.saved, true);
  assert.equal(result.progress?.completed, true);
  assert.match(captured[1].text, /ON CONFLICT \(user_id, novel_id\)[\s\S]*client_saved_at_ms/u);
  assert.match(captured[2].text, /novel_read_daily_stats/u);
  assert.match(captured[3].text, /user_read_daily_stats/u);
});

test("PostgreSQL reading history clamps page in SQL and hides records in bounded batches", async () => {
  const captured: SqlQuery[] = [];
  const page = await listPostgresReadingProgressPage(executorQueue([{
    rows: [progressRow({ total_items: "101", page: 3 })],
  }], captured), 4, { page: 99, pageSize: 50 });
  assert.equal(page.page, 3);
  assert.equal(page.totalPages, 3);
  assert.deepEqual(captured[0].values, [4, 50, 99]);
  assert.match(captured[0].text, /LEFT JOIN LATERAL/u);

  const hiddenQueries: SqlQuery[] = [];
  const hidden = await hidePostgresReadingProgress(executorQueue([{ rowCount: 2 }], hiddenQueries), 4, [7, 7, 8, -1]);
  assert.equal(hidden, 2);
  assert.deepEqual(hiddenQueries[0].values, [4, [7, 8]]);
  assert.match(hiddenQueries[0].text, /ANY\(\$2::integer\[\]\)/u);
});
