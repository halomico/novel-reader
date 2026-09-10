import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { deletePostgresOriginalReadingProgressMany, getPostgresOriginalAccess, updatePostgresOriginalReadingProgress } from "./postgres-reading";

function queued(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return { async query<Row extends QueryResultRow>(query: SqlQuery) {
    captured.push(query);
    const response = responses.shift() ?? {};
    const rows = response.rows ?? [];
    return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
  } };
}

test("PostgreSQL original access evaluates paid entitlements without returning content", async () => {
  const captured: SqlQuery[] = [];
  const access = await getPostgresOriginalAccess(queued([{ rows: [{ exists: true, purchased: true, allowed: true }] }], captured), 7, { id: 3, role: "user" });
  assert.deepEqual(access, { exists: true, purchased: true, allowed: true });
  assert.doesNotMatch(captured[0].text, /body_markdown/u);
});

test("PostgreSQL original progress rechecks paid access in the write query", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rows: [{
    article_id: "7", scroll_ratio: 0.5, progress_percent: 50, completed: false,
    visit_count: "2", last_read_at: "2026-09-08T04:00:00Z",
  }] }], captured);
  const result = await updatePostgresOriginalReadingProgress(executor, 3, 7, 0.5);
  assert.equal(result.saved, true);
  assert.equal(result.progress?.progressPercent, 50);
  assert.match(captured[0].text, /EXISTS \(SELECT 1 FROM original_purchases/u);
  assert.match(captured[0].text, /abs\(original_reading_history.scroll_ratio/u);
});

test("PostgreSQL original history deletion is bounded and parameterized", async () => {
  const captured: SqlQuery[] = [];
  const deleted = await deletePostgresOriginalReadingProgressMany(queued([{ rowCount: 2 }], captured), 3, [7, 7, 8]);
  assert.equal(deleted, 2);
  assert.deepEqual(captured[0].values, [3, [7, 8]]);
  assert.match(captured[0].text, /ANY\(\$2::bigint\[\]\)/u);
});
