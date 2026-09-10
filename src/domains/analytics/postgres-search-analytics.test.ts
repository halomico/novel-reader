import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  normalizePostgresSearchAnalyticsQuery,
  recordPostgresSearchQuery,
  recordPostgresSearchResultClick,
  resolvePostgresSearchEventKey,
  updatePostgresSearchQueryResults,
} from "./postgres-search-analytics";

function executorWith(rows: QueryResultRow[], captured: SqlQuery[]): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

test("search event creation stores a simple-AND term set atomically in PostgreSQL", async () => {
  const captured: SqlQuery[] = [];
  const eventKey = "123e4567-e89b-42d3-a456-426614174000";
  const result = await recordPostgresSearchQuery(executorWith([{ event_key: eventKey }], captured), "  修仙   校园  ", "content", {
    source: "advanced_tags", userId: 4, originNovelId: 8,
  });
  assert.equal(result, eventKey);
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /inserted_event[\s\S]*inserted_terms/);
  assert.deepEqual(captured[0].values?.slice(1, 6), ["修仙 校园", "content", "advanced_tags", 4, 8]);
  assert.deepEqual(captured[0].values?.at(-1), ["修仙", "校园"]);
  assert.equal(normalizePostgresSearchAnalyticsQuery(" Ａ  B "), "a b");
});

test("search analytics validates event keys before PostgreSQL mutations", async () => {
  const captured: SqlQuery[] = [];
  const executor = executorWith([], captured);
  assert.equal(await resolvePostgresSearchEventKey(executor, "invalid", "修仙"), null);
  assert.equal(await updatePostgresSearchQueryResults(executor, "invalid", 1, 1), false);
  assert.equal(await recordPostgresSearchResultClick(executor, "invalid", 1), false);
  assert.equal(captured.length, 0);
});
