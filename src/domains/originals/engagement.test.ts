import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { recordOriginalEngagement } from "./engagement";

function queued(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return { async query<Row extends QueryResultRow>(query: SqlQuery) {
    captured.push(query);
    const response = responses.shift() ?? {};
    const rows = response.rows ?? [];
    return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
  } };
}

test("PostgreSQL original detail engagement increments a published article exactly once", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rowCount: 1 }, { rowCount: 1 }, { rows: [] }, { rows: [] }, { rowCount: 1 }, { rowCount: 1 },
  ], captured);
  const result = await recordOriginalEngagement({
    eventId: "original_view_event_0001", viewerKey: "guest:test", articleId: 7,
  }, async (operation) => operation(executor));
  assert.deepEqual(result, { recorded: true, counted: true, readingHistoryRecorded: false, duplicateEvent: false });
  assert.match(captured[0].text, /status = 'published'.*FOR KEY SHARE/u);
  assert.match(captured[5].text, /view_count = view_count \+ 1/u);
});

test("a counted signed-in original visit grows a planted grove item", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rowCount: 1 }, { rowCount: 1 }, { rows: [] }, { rows: [] }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 },
  ], captured);
  await recordOriginalEngagement({
    eventId: "original_view_event_0002", viewerKey: "user:3", articleId: 7, userId: 3,
  }, async (operation) => operation(executor));
  const groveUpdate = captured.find((query) => /UPDATE user_original_grove SET visit_count = visit_count \+ 1/u.test(query.text));
  assert.deepEqual(groveUpdate?.values, [3, 7]);
});

test("a fresh signed-in original visit grows the grove inside the public dedupe window", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rowCount: 1 }, { rowCount: 1 }, { rows: [] }, { rows: [{ found: true }] },
    { rowCount: 1 }, { rowCount: 1 },
  ], captured);
  const result = await recordOriginalEngagement({
    eventId: "original_view_event_0003", viewerKey: "user:3", articleId: 7, userId: 3,
  }, async (operation) => operation(executor));
  assert.deepEqual(result, { recorded: true, counted: false, readingHistoryRecorded: false, duplicateEvent: false });
  assert.match(captured.at(-1)?.text || "", /UPDATE user_original_grove SET visit_count = visit_count \+ 1/u);
  assert.deepEqual(captured.at(-1)?.values, [3, 7]);
});

test("PostgreSQL original engagement replay has no repeated counter side effect", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rowCount: 1 }, { rowCount: 1 }, { rows: [{ counted: true }] }], captured);
  const result = await recordOriginalEngagement({
    eventId: "original_view_event_0001", viewerKey: "guest:test", articleId: 7,
  }, async (operation) => operation(executor));
  assert.deepEqual(result, { recorded: true, counted: true, readingHistoryRecorded: false, duplicateEvent: true });
  assert.equal(captured.length, 3);
});
