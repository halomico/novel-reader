import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { hasPostgresUserPermission } from "./postgres-permissions";

test("PostgreSQL permissions short-circuit admins and bind member levels and permission names", async () => {
  const captured: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ allowed: true }] } as unknown as QueryResult<Row>;
    },
  };
  assert.equal(await hasPostgresUserPermission(executor, { role: "admin", trustLevel: 1 }, "market_access"), true);
  assert.equal(captured.length, 0);
  assert.equal(await hasPostgresUserPermission(executor, { role: "user", trustLevel: 4 }, "advanced_search"), true);
  assert.deepEqual(captured[0].values, [4, "advanced_search"]);
  assert.match(captured[0].text, /permissions \? \$2/);
  await assert.rejects(hasPostgresUserPermission(executor, { role: "user", trustLevel: 7 }, "advanced_search"), /trust level/);
});
