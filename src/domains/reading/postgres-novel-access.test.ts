import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { getPostgresNovelReadAccess } from "./postgres-novel-access";

const locked = { id: 8, sourceId: 3, accessMode: "soda" as const, sodaPrice: 12 };

test("PostgreSQL novel access keeps free/admin paths queryless and checks both entitlement scopes", async () => {
  const captured: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ allowed: true }] } as unknown as QueryResult<Row>;
    },
  };
  assert.equal((await getPostgresNovelReadAccess(executor, locked, { id: 1, role: "admin" }, "member")).reason, "admin");
  assert.equal((await getPostgresNovelReadAccess(executor, { ...locked, accessMode: "inherit" }, null, "public")).reason, "public");
  assert.equal(captured.length, 0);
  const access = await getPostgresNovelReadAccess(executor, locked, { id: 5, role: "user" }, "member");
  assert.deepEqual(access, { allowed: true, reason: "granted", price: 12 });
  assert.deepEqual(captured[0].values, [5, "8", 3]);
  assert.match(captured[0].text, /resource_type = 'novel'[\s\S]*resource_type = 'novel_source'/);
  assert.match(captured[0].text, /rights \? 'read'/);
});

test("locked PostgreSQL novels fail closed before entitlement lookup when content is not consumable", async () => {
  const executor: SqlExecutor = { query: async () => { throw new Error("must not query"); } };
  assert.deepEqual(await getPostgresNovelReadAccess(executor, locked, null, "browse"), {
    allowed: false, reason: "login_required", price: 12,
  });
});

test("locked PostgreSQL chapter previews remain readable before an unlock", async () => {
  const executor: SqlExecutor = {
    query: async () => ({ rows: [{ allowed: false }] }) as never,
  };
  const access = await getPostgresNovelReadAccess(executor, locked, { id: 5, role: "user" }, "member", {
    storageMode: "chapters", chapterCount: 10, previewChapterCount: 0, chapterSortOrder: 2,
  });
  assert.deepEqual(access, { allowed: true, reason: "preview", price: 12 });
});
