import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  createPostgresContentReport,
  isMediaReportCategory,
  isOriginalReportCategory,
  listPostgresContentReports,
  setPostgresContentReportStatus,
} from "./postgres-reports";

function queued(
  responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>,
  captured: SqlQuery[],
): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const response = responses.shift() ?? {};
      const rows = response.rows ?? [];
      return {
        command: "SELECT",
        rowCount: response.rowCount ?? rows.length,
        oid: 0,
        fields: [],
        rows,
      } as unknown as QueryResult<Row>;
    },
  };
}

test("PostgreSQL reports validate target-specific categories before querying", async () => {
  assert.equal(isMediaReportCategory("playback_error"), true);
  assert.equal(isMediaReportCategory("tag_error"), false);
  assert.equal(isOriginalReportCategory("tag_error"), true);
  let transactionCalls = 0;
  const result = await createPostgresContentReport({
    userId: 2,
    mediaId: 8,
    category: "tag_error",
    details: "",
    dailyLimit: 3,
  }, async () => {
    transactionCalls += 1;
    throw new Error("must not run");
  });
  assert.deepEqual(result, { ok: false, reason: "invalid" });
  assert.equal(transactionCalls, 0);
});

test("PostgreSQL report creation serializes quota checks and inserts atomically", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ status: "active", role: "user", username: "reader", display_name: "读者" }] },
    { rows: [{ title: "测试小说" }] },
    { rows: [{ report_count: "1" }] },
    { rows: [{ id: "12" }] },
  ], captured);
  const result = await createPostgresContentReport({
    userId: 2,
    novelId: 8,
    category: "tag_error",
    details: " 标签错误 ",
    dailyLimit: 2,
  }, async (operation) => operation(executor));
  assert.deepEqual(result, { ok: true, id: 12 });
  assert.match(captured[0].text, /FOR UPDATE/u);
  assert.match(captured[2].text, /date_trunc/u);
  assert.deepEqual(captured[3].values, [2, 8, null, null, "tag_error", "标签错误"]);
});

test("PostgreSQL report listing returns page metadata and typed rows in one query", async () => {
  const captured: SqlQuery[] = [];
  const result = await listPostgresContentReports(queued([{ rows: [{
    total_reports: "1", total_pages: "1", page: "1", id: "5", user_id: "2",
    username: "reader", user_display_name: "读者", novel_id: 8, media_id: null,
    original_article_id: null, target_title: "测试小说", target_slug: null,
    media_kind: null, category: "other", details: "错字", status: "open",
    resolved_by: null, resolved_at: null, created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
  }] }], captured), { status: "open", page: 1, pageSize: 30 });
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /MATERIALIZED/u);
  assert.equal(result.reports[0].targetType, "novel");
  assert.equal(result.reports[0].targetTitle, "测试小说");
  assert.equal(result.totalReports, 1);
});

test("PostgreSQL report status updates remain parameterized", async () => {
  const captured: SqlQuery[] = [];
  assert.equal(await setPostgresContentReportStatus(
    queued([{ rowCount: 1 }], captured), 7, "resolved", " moderator ",
  ), true);
  assert.deepEqual(captured[0].values, [7, "moderator"]);
  assert.match(captured[0].text, /clock_timestamp/u);
});
