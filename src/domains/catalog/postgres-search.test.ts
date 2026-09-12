import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { parseSimpleAndSearchQuery } from "@/lib/search-query";
import {
  buildPostgresAdvancedCatalogCountQuery,
  buildPostgresAdvancedCatalogSearchQuery,
  buildPostgresCatalogTitleSearchQuery,
  escapePostgresLikePattern,
  listPostgresCatalogSearchTagGroups,
  searchPostgresAdvancedCatalog,
  searchPostgresCatalogTitles,
} from "./postgres-search";

function validQuery(keyword: string) {
  const result = parseSimpleAndSearchQuery(keyword, { mode: "title" });
  if (result.ok !== true) throw new Error("message" in result ? result.message : "invalid query");
  return result.query;
}

test("PostgreSQL title search intersects keywords and binds LIKE metacharacters", async () => {
  assert.equal(escapePostgresLikePattern("a%b_c\\d"), "a\\%b\\_c\\\\d");
  const query = await buildPostgresCatalogTitleSearchQuery(validQuery("仙 校园"), { sourceId: 4, limit: 10 });
  assert.match(query.text, /title_search_original LIKE/);
  assert.match(query.text, /n\.source_id = \$\d+/);
  assert.match(query.text, /LIMIT \$\d+/);
  assert.ok(query.values?.every((value) => typeof value === "string" || typeof value === "number"));
  assert.doesNotMatch(query.text, /校园/);
});

test("title search preserves punctuation, shares Hans forms, and avoids dynamic prepared statement names", async () => {
  const query = await buildPostgresCatalogTitleSearchQuery(validQuery("Ａ_傳說%"));
  assert.equal(query.name, undefined);
  assert.ok(query.values?.includes("a\\_傳說\\%"));
  assert.ok(query.values?.includes("a\\_传说\\%"));
  assert.doesNotMatch(query.text, /relative_path|COALESCE\(.*title_search_hans/);
  assert.match(query.text, /title_search_hans IS NOT NULL AND/);
  const literalOperators = await buildPostgresCatalogTitleSearchQuery(validQuery("仙 OR 校园"));
  assert.ok(literalOperators.values?.includes("or"));
  assert.doesNotMatch(literalOperators.text, /\sOR\sTRUE|NOT\s+EXISTS/u);
});

test("catalog rejects invalid cursors and sources without querying", async () => {
  const query = validQuery("仙");
  for (const sortValue of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1; DROP TABLE novels", "9223372036854775808"]) {
    await assert.rejects(buildPostgresCatalogTitleSearchQuery(query, { cursor: { sortValue, id: 1 } }), /cursor/);
  }
  await assert.rejects(buildPostgresCatalogTitleSearchQuery(query, { cursor: { sortValue: "1", id: 0 } }), /cursor/);
  await assert.rejects(buildPostgresCatalogTitleSearchQuery(query, { sourceId: NaN }), /source/);
  const valid = await buildPostgresCatalogTitleSearchQuery(query, { cursor: { sortValue: "9223372036854775807", id: 1 } });
  assert.ok(valid.values?.includes("9223372036854775807"));
});

test("PostgreSQL catalog search returns a bounded page and a stable keyset cursor", async () => {
  const query = validQuery("修仙");
  const captured: { text: string; values: readonly unknown[] }[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(sql: SqlQuery) {
      captured.push({ text: sql.text, values: sql.values || [] });
      return {
        command: "SELECT",
        rowCount: 3,
        oid: 0,
        fields: [],
        rows: [
          { id: 3, title: "甲", description: "", source_id: null, storage_mode: "single", chapter_count: 0, access_mode: "inherit", soda_price: 0, word_count: 10, mtime_ms: "30", updated_at: "2026-09-01T00:00:00Z", cursor_sort_value: "30" },
          { id: 2, title: "乙", description: "", source_id: null, storage_mode: "single", chapter_count: 0, access_mode: "inherit", soda_price: 0, word_count: 9, mtime_ms: "20", updated_at: "2026-09-01T00:00:00Z", cursor_sort_value: "20" },
          { id: 1, title: "丙", description: "", source_id: null, storage_mode: "single", chapter_count: 0, access_mode: "inherit", soda_price: 0, word_count: 8, mtime_ms: "10", updated_at: "2026-09-01T00:00:00Z", cursor_sort_value: "10" },
        ],
      } as unknown as QueryResult<Row>;
    },
  };
  const page = await searchPostgresCatalogTitles(executor, query, { limit: 2 });
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.nextCursor, { sortValue: "20", id: 2 });
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /LIMIT/);
});

test("catalog result count reuses the exact filters but removes cursor, order and limit", async () => {
  const query = await buildPostgresAdvancedCatalogCountQuery(validQuery("修仙 校园"), {
    sourceId: 4,
    access: "free",
  });
  assert.match(query.text, /^SELECT COUNT\(\*\)::bigint AS total FROM novels n/u);
  assert.doesNotMatch(query.text, /ORDER BY|LIMIT|cursor_sort_value/u);
  assert.equal(query.values?.at(-1), 4);
});

test("catalog rejects corrupt PostgreSQL enum and identifier values at the boundary", async () => {
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>() {
      return {
        command: "SELECT", rowCount: 1, oid: 0, fields: [],
        rows: [{ id: 1, title: "甲", description: "", source_id: "9223372036854775807",
          storage_mode: "archive", chapter_count: 0, access_mode: "inherit", soda_price: 0,
          word_count: 1, mtime_ms: "1", updated_at: "2026-09-01T00:00:00Z" }],
      } as unknown as QueryResult<Row>;
    },
  };
  await assert.rejects(searchPostgresCatalogTitles(executor, validQuery("甲")), /source id|storage mode/);
});

test("advanced catalog search intersects tags and binds numeric page offsets", async () => {
  const query = await buildPostgresAdvancedCatalogSearchQuery(undefined, {
    sourceId: 4,
    includeTagSlugs: ["fantasy", "campus"],
    excludeTagSlugs: ["spoiler"],
    audience: "member",
    limit: 15,
  });
  assert.equal((query.text.match(/EXISTS \(/g) || []).length, 3);
  assert.match(query.text, /tag\.visibility IN \('public', 'member'\)/);
  assert.doesNotMatch(query.text, /OFFSET|COUNT\(\*\)/);
  assert.ok(query.values?.includes("fantasy"));
  assert.ok(query.values?.some((value) => Array.isArray(value) && value.includes("spoiler")));
  const legacySlugQuery = await buildPostgresAdvancedCatalogSearchQuery(undefined, {
    includeTagSlugs: ["boss_employee"],
    limit: 15,
  });
  assert.ok(legacySlugQuery.values?.includes("boss_employee"));
  const numberedPage = await buildPostgresAdvancedCatalogSearchQuery(undefined, {
    includeTagSlugs: ["fantasy"],
    offset: 3_980,
    limit: 20,
  });
  assert.match(numberedPage.text, /LIMIT \$\d+::integer OFFSET \$\d+::integer/u);
  assert.equal(numberedPage.values?.at(-1), 3_980);
  await assert.rejects(buildPostgresAdvancedCatalogSearchQuery(undefined, {
    includeTagSlugs: ["fantasy"],
    offset: 20,
    cursor: { sortValue: "10", id: 1 },
  }), /cannot be combined/);
  await assert.rejects(searchPostgresAdvancedCatalog({ query: async () => { throw new Error("must not query"); } }, undefined), /at least one filter/);
});

test("tag browsing random order is stable, bound, and keyset-paginated", async () => {
  const query = await buildPostgresAdvancedCatalogSearchQuery(undefined, {
    includeTagSlugs: ["xuan-huan"],
    randomSeed: "surprise-1",
    cursor: { sortValue: "0123456789abcdef0123456789abcdef", id: 8 },
  });
  assert.match(query.text, /md5\(\$\d+ \|\| ':' \|\| n\.id::text\)/);
  assert.match(query.text, /> \(\$\d+::text COLLATE "C", \$\d+::integer\)/);
  assert.doesNotMatch(query.text, /OFFSET|surprise-1/);
  assert.ok(query.values?.includes("surprise-1"));
  await assert.rejects(
    buildPostgresAdvancedCatalogSearchQuery(undefined, {
      includeTagSlugs: ["xuan-huan"],
      randomSeed: "surprise-1",
      cursor: { sortValue: "not-a-hash", id: 8 },
    }),
    /random catalog cursor/,
  );
});

test("advanced tag picker applies recursive user hides and source counts in one query", async () => {
  const captured: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return {
        command: "SELECT", rowCount: 3, oid: 0, fields: [],
        rows: [
          { id: "1", parent_id: null, name: "题材", slug: "genre", aliases: [], direct_count: "0" },
          { id: "2", parent_id: "1", name: "奇幻", slug: "fantasy", aliases: ["玄幻"], direct_count: "9" },
          { id: "3", parent_id: null, name: "独立", slug: "standalone", aliases: "[]", direct_count: "2" },
        ],
      } as unknown as QueryResult<Row>;
    },
  };
  const groups = await listPostgresCatalogSearchTagGroups(executor, {
    audience: "member", sourceId: 7, userId: 11,
  });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].values, [11, 7]);
  assert.match(captured[0].text, /WITH RECURSIVE hidden/);
  assert.match(captured[0].text, /WHERE n\.source_id = \$2/);
  assert.deepEqual(groups.map((group) => [group.label, group.tags.map((tag) => tag.name)]), [
    ["题材", ["奇幻"]], ["独立", ["独立"]],
  ]);
});
