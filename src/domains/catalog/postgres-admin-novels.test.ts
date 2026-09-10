import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { listPostgresAdminBooks } from "./postgres-admin-novels";

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}

test("admin novel lists read the migrated text IP column without calling inet-only host()", async () => {
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      return result(query.text.includes("COUNT(*)") ? [{ total: "0" } as unknown as Row] : []);
    },
  };

  const books = await listPostgresAdminBooks(executor, {});

  assert.equal(books.totalBooks, 0);
  assert.equal(queries.length, 2);
  assert.doesNotMatch(queries[1].text, /\bhost\s*\(/iu);
  assert.match(queries[1].text, /n\.last_accessed_ip/iu);
});
