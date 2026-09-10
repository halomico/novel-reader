import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { getPostgresAdminAnalyticsOverview } from "./postgres-admin-analytics";

function emptyResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}

test("admin analytics orders collated metrics by source expressions instead of SELECT aliases", async () => {
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      const rows = /^SELECT COUNT/iu.test(query.text.trim())
        ? [{ count: "0" } as unknown as Row]
        : [];
      return emptyResult(rows);
    },
  };

  const overview = await getPostgresAdminAnalyticsOverview(executor, "24h");

  assert.equal(overview.totalViews, 0);
  assert.equal(overview.realtime.length, 0);
  assert.ok(queries.length > 10);
  assert.equal(queries.some((query) => /\blabel\s+COLLATE\b/iu.test(query.text)), false);
  assert.equal(queries.some((query) => /(?<!\.)\bcountry\s+COLLATE\b/iu.test(query.text)), false);
  assert.ok(queries.some((query) => /s\.query\s+COLLATE\s+"C"/u.test(query.text)));
});
