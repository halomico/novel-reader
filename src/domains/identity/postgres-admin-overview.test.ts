import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  getPostgresAdminCatalogStats,
  listPostgresAdminLoginRecordPage,
  recordPostgresAdminLogin,
} from "./postgres-admin-overview";

function queued(resultRows: QueryResultRow[][], captured: SqlQuery[] = []): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const rows = resultRows.shift() ?? [];
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

test("admin login audit writes bounded PostgreSQL values", async () => {
  const queries: SqlQuery[] = [];
  await recordPostgresAdminLogin(queued([[]], queries), " admin ", "127.0.0.1", "UA".repeat(200));
  assert.match(queries[0].text, /INSERT INTO admin_login_records/);
  assert.equal(queries[0].values?.[0], "admin");
  assert.equal(String(queries[0].values?.[2]).length, 240);
});

test("admin login history clamps the page and maps timestamps", async () => {
  const page = await listPostgresAdminLoginRecordPage(queued([
    [{ total: "16" }],
    [{ username: "admin", ip: "127.0.0.1", user_agent: "browser", logged_at: "2026-09-08T00:00:00.000Z" }],
  ]), 99, 15);
  assert.equal(page.page, 2);
  assert.equal(page.totalPages, 2);
  assert.equal(page.records[0].loggedAt, "2026-09-08T00:00:00.000Z");
});

test("admin catalog stats normalize PostgreSQL bigints", async () => {
  const stats = await getPostgresAdminCatalogStats(queued([[{ total_books: "8", total_size_bytes: "4096" }]]));
  assert.deepEqual(stats, { totalBooks: 8, totalSizeBytes: 4096 });
});
