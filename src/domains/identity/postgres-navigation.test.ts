import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { readPostgresUserNavigationState } from "./postgres-navigation";

test("header navigation state combines unread messages and market permission in one PostgreSQL query", async () => {
  const captured: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ unread_messages: "12", market_access: true }] } as unknown as QueryResult<Row>;
    },
  };
  const state = await readPostgresUserNavigationState(executor, { id: 9, role: "user", trustLevel: 3 });
  assert.deepEqual(state, { unreadMessages: 12, marketAccess: true });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].values, [9, 3, "user"]);
  assert.match(captured[0].text, /announcement_reads[\s\S]*station_messages[\s\S]*market_access/);
  assert.doesNotMatch(captured[0].text, /sqlite/i);
});
