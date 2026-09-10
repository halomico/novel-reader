import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { getPostgresVideoDownloadAccess } from "./postgres-media-access";

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}

test("video entitlement lookup gives reused identifiers explicit native PostgreSQL types", async () => {
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      if (queries.length === 1) {
        return result([{ id: "7", category_id: null, play_soda_price: 1 } as unknown as Row]);
      }
      if (queries.length === 2) {
        return result([{ allowed: false } as unknown as Row]);
      }
      return result([]);
    },
  };

  const access = await getPostgresVideoDownloadAccess(executor, 7, { id: 11, role: "user" });

  assert.equal(access?.allowed, false);
  assert.match(queries[1].text, /relation\.media_id = \$2::bigint/u);
  assert.match(queries[1].text, /entitlement\.resource_id = \$2::text/u);
});
