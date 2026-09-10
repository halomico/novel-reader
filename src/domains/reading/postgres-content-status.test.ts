import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlQuery } from "@/core/db/postgres";
import { readPostgresContentIndexStatus } from "./postgres-content-status";

test("PostgreSQL content status evaluates complete generations per book in one query", async () => {
  const queries: string[] = [];
  const result = await readPostgresContentIndexStatus({
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query.text);
      return { rows: [
        { source_id: 1, slug: "default", name: "默认", total_books: "3", indexed_books: "2",
          stale_books: "1", failed_books: "0", source_bytes: "300", indexed_bytes: "210",
          last_indexed_at: "2026-09-08T00:00:00Z", database_bytes: "500" },
        { source_id: 2, slug: "light", name: "轻量", total_books: "1", indexed_books: "0",
          stale_books: "0", failed_books: "1", source_bytes: "90", indexed_bytes: "0",
          last_indexed_at: null, database_bytes: "500" },
      ] } as unknown as QueryResult<Row>;
    },
  }, { light: "book" });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /bool_and\(ready\)/u);
  assert.match(queries[0], /g\.source_content_version IS NOT DISTINCT FROM e\.content_hash/u);
  assert.equal(result.sources[0].state, "pending");
  assert.equal(result.sources[1].state, "failed");
  assert.equal(result.sources[1].mode, "book");
  assert.equal(result.summary.pendingBooks, 2);
  assert.equal(result.summary.databaseBytes, 500);
  assert.equal(result.summary.databaseRatio, 500 / 390);
});
