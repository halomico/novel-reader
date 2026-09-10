import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  getPostgresCatalogTagBySlug,
  listPostgresCatalogTagGroups,
  listPostgresExplicitlyHiddenTagIds,
  replacePostgresUserHiddenTags,
} from "./postgres-tags";

function executorWithRows(rows: QueryResultRow[], captured: SqlQuery[] = []): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

const tag = (id: number, parentId: number | null, count: number) => ({
  id: String(id), parent_id: parentId === null ? null : String(parentId), name: `标签${id}`,
  slug: `tag-${id}`, description: "说明", aliases: ["别名"], sort_order: id,
  visibility: "public", direct_count: String(count),
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z",
});

test("PostgreSQL tag library returns ordered groups and keeps empty choices manageable", async () => {
  const captured: SqlQuery[] = [];
  const groups = await listPostgresCatalogTagGroups(executorWithRows([
    tag(1, null, 0), tag(2, 1, 3), tag(3, 1, 0), tag(4, 99, 2),
  ], captured), { audience: "member", omitEmpty: false });
  assert.deepEqual(groups.map((group) => [group.group?.id ?? null, group.tags.map((item) => item.id)]), [
    [1, [2, 3]], [null, [4]],
  ]);
  assert.match(captured[0].text, /tag\.visibility IN \('public', 'member'\)/);
  assert.match(captured[0].text, /count\(\*\)::bigint/);
});

test("explicit user hides are separate from effective descendant filtering", async () => {
  const ids = await listPostgresExplicitlyHiddenTagIds(executorWithRows([{ tag_id: "5" }, { tag_id: "9" }]), 7);
  assert.deepEqual(ids, new Set([5, 9]));
});

test("tag detail lookup is visibility-aware and parameterized", async () => {
  const captured: SqlQuery[] = [];
  const found = await getPostgresCatalogTagBySlug(executorWithRows([tag(3, 1, 4)], captured), "TAG-3", { audience: "public" });
  assert.equal(found?.slug, "tag-3");
  assert.deepEqual(captured[0].values, ["tag-3"]);
  assert.match(captured[0].text, /tag\.visibility = 'public'/);
  assert.equal(await getPostgresCatalogTagBySlug(executorWithRows([]), "../bad"), null);
});

test("tag preference replacement validates once and commits delete plus bulk insert", async () => {
  const queries: SqlQuery[] = [];
  const transaction = async <T>(operation: (executor: SqlExecutor) => Promise<T>) => operation({
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      const rows = queries.length === 1 ? [{ id: "2" }, { id: "4" }] : [];
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  });
  const saved = await replacePostgresUserHiddenTags(3, [4, 2, 4], transaction as typeof import("@/core/db/postgres").withTransaction);
  assert.deepEqual(saved, [2, 4]);
  assert.match(queries[0].text, /FOR SHARE/);
  assert.match(queries[1].text, /DELETE FROM user_hidden_tags/);
  assert.match(queries[2].text, /unnest\(\$2::bigint\[\]\)/);
  await assert.rejects(replacePostgresUserHiddenTags(3, [0], transaction as typeof import("@/core/db/postgres").withTransaction), /hidden tag id/);
});
