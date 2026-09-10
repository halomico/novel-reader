import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  isPostgresMediaFavorite,
  listPostgresFavoriteOriginals,
  removePostgresMediaFavorites,
  togglePostgresOriginalFavorite,
} from "./postgres-favorites";

function queued(responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>, captured: SqlQuery[]): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const response = responses.shift() ?? {};
      const rows = response.rows ?? [];
      return { command: "SELECT", rowCount: response.rowCount ?? rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

test("PostgreSQL favorite state and batch removal are parameterized", async () => {
  const captured: SqlQuery[] = [];
  assert.equal(await isPostgresMediaFavorite(queued([{ rows: [{ favorite: true }] }], captured), 2, 4), true);
  assert.equal(await removePostgresMediaFavorites(queued([{ rowCount: 2 }], captured), 2, "video", [4, 5]), 2);
  assert.match(captured[1].text, /DELETE FROM user_media_favorites/u);
  assert.deepEqual(captured[1].values, [2, [4, 5], "video"]);
});

test("PostgreSQL original favorite toggle serializes concurrent mutations", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([{ rowCount: 1 }, { rowCount: 0 }, { rowCount: 1 }], captured);
  const result = await togglePostgresOriginalFavorite(2, 8, async (operation) => operation(executor));
  assert.deepEqual(result, { ok: true, favorite: true });
  assert.match(captured[0].text, /pg_advisory_xact_lock/u);
  assert.match(captured[2].text, /status = 'published'/u);
});

test("PostgreSQL original favorites return metadata and light row DTOs in one query", async () => {
  const captured: SqlQuery[] = [];
  const result = await listPostgresFavoriteOriginals(queued([{ rows: [{
    total_items: "1", total_pages: "1", page: "1", id: "9", slug: "story",
    author_id: "3", author_name: "作者", author_avatar_path: null, title: "标题",
    word_count: "88", unlock_soda_price: "0", status: "published", is_pinned: false,
    comment_count: "2", created_at: "2026-09-08T00:00:00Z", published_at: "2026-09-08T00:00:00Z",
    tags: [{ id: 4, name: "奇幻", slug: "fantasy" }],
  }] }], captured), 3, { page: 1, pageSize: 20 });
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /LEFT JOIN LATERAL/u);
  assert.equal(result.items[0].title, "标题");
  assert.deepEqual(result.items[0].tags, [{ id: 4, name: "奇幻", slug: "fantasy" }]);
});
