import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  postgresAnalyticsRetentionDays,
  prunePostgresAnalyticsRetention,
} from "./postgres-retention";

function executor(rowCounts: number[], queries: SqlQuery[]): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      const rowCount = rowCounts.shift() ?? 0;
      return { command: "DELETE", rowCount, oid: 0, fields: [], rows: [] } as unknown as QueryResult<Row>;
    },
  };
}

test("PostgreSQL analytics retention uses bounded lock-friendly deletes", async () => {
  const queries: SqlQuery[] = [];
  const deleted = await prunePostgresAnalyticsRetention(executor([2, 3, 4], queries), 30, 250);
  assert.equal(deleted, 9);
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.match(query.text, /FOR UPDATE SKIP LOCKED/);
    assert.match(query.text, /make_interval\(days => \$1\)/);
    assert.deepEqual(query.values, [30, 250]);
  }
});

test("PostgreSQL analytics retention normalizes environment values", () => {
  assert.equal(postgresAnalyticsRetentionDays("1"), 7);
  assert.equal(postgresAnalyticsRetentionDays("99999"), 3_650);
  assert.equal(postgresAnalyticsRetentionDays("invalid"), 180);
});

test("PostgreSQL analytics retention rejects unsafe bounds", async () => {
  await assert.rejects(() => prunePostgresAnalyticsRetention(executor([], []), 6), /retention days/);
  await assert.rejects(() => prunePostgresAnalyticsRetention(executor([], []), 30, 0), /batch size/);
});
