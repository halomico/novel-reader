import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { parseSimpleAndSearchQuery, type ParsedSearchQuery } from "@/lib/search-query";
import {
  buildPostgresOriginalCandidateQuery,
  countPostgresOriginalArticles,
  listPostgresOriginalSearchTags,
  searchPostgresOriginalArticles,
} from "./postgres-search";

function query(value: string, mode: "title" | "content"): ParsedSearchQuery {
  const result = parseSimpleAndSearchQuery(value, { mode });
  if (result.ok !== true) throw new Error(result.message);
  return result.query;
}

test("locked paid originals are filtered in SQL before title or body can leave PostgreSQL", async () => {
  const anonymous = await buildPostgresOriginalCandidateQuery({
    viewer: null,
    contentQuery: query("龍門", "content"),
  });
  assert.match(anonymous.text, /a\.unlock_soda_price = 0/);
  assert.doesNotMatch(anonymous.text, /original_purchases access_purchase/);

  const member = await buildPostgresOriginalCandidateQuery({
    viewer: { id: 42, role: "user" },
    titleQuery: query("傳說", "title"),
  });
  assert.match(member.text, /a\.author_id = \$1/);
  assert.match(member.text, /original_purchases access_purchase/);
  assert.equal(member.values?.filter((value) => value === 42).length, 1);
  assert.doesNotMatch(member.text, /傳說/);

  const admin = await buildPostgresOriginalCandidateQuery({
    viewer: { id: 1, role: "admin" },
    titleQuery: query("傳說", "title"),
  });
  assert.match(admin.text, /AND TRUE AND/);
  assert.doesNotMatch(admin.text, /original_purchases access_purchase/);
});

test("tag filters and cursors are bound, validated and never interpolated", async () => {
  const compiled = await buildPostgresOriginalCandidateQuery({
    viewer: null,
    titleQuery: query("文章", "title"),
    includeTagSlugs: ["xian-xia"],
    excludeTagSlugs: ["spoiler"],
    cursor: { sortAt: "2026-09-07T01:02:03.000Z", id: "99" },
  });
  assert.match(compiled.text, /original_article_tags included_link/);
  assert.match(compiled.text, /original_article_tags excluded_link/);
  assert.match(compiled.text, /::timestamptz/);
  assert.doesNotMatch(compiled.text, /xian-xia|spoiler|2026-09-07/);
  assert.ok(compiled.values?.includes("xian-xia"));
  assert.ok(compiled.values?.includes("spoiler"));

  await assert.rejects(buildPostgresOriginalCandidateQuery({
    viewer: null,
    titleQuery: query("文章", "title"),
    includeTagSlugs: ["bad slug"],
  }), /tags/);
  await assert.rejects(buildPostgresOriginalCandidateQuery({
    viewer: null,
    titleQuery: query("文章", "title"),
    cursor: { sortAt: "not-a-date", id: "1" },
  }), /cursor/);

  const numberedPage = await buildPostgresOriginalCandidateQuery({
    viewer: null,
    titleQuery: query("文章", "title"),
    offset: 3_980,
    limit: 20,
  });
  assert.match(numberedPage.text, /LIMIT \$\d+::integer OFFSET \$\d+::integer/u);
  assert.equal(numberedPage.values?.at(-1), 3_980);
  await assert.rejects(buildPostgresOriginalCandidateQuery({
    viewer: null,
    titleQuery: query("文章", "title"),
    offset: 20,
    cursor: { sortAt: "2026-09-07T01:02:03.000Z", id: "99" },
  }), /cannot be combined/);
});

test("original PostgreSQL search treats former operator words as literal AND terms", async () => {
  const literal = parseSimpleAndSearchQuery("修仙 AND 龍門", { mode: "content" });
  if (!literal.ok) throw new Error(literal.message);
  const query = await buildPostgresOriginalCandidateQuery({ viewer: null, contentQuery: literal.query });
  assert.ok(query.values?.includes("and"));
  assert.doesNotMatch(query.text, /NOT \(/u);
});

test("original search maps PostgreSQL-filtered rows and returns a stable cursor", async () => {
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(_sql: SqlQuery) {
      return {
        command: "SELECT", rowCount: 2, oid: 0, fields: [], rows: [
          {
            id: "2", slug: "hit", title: "候选二", excerpt: "简介",
            body_markdown: "这里确实是修仙龍门故事", paid_body_markdown: "", author_id: "8",
            author_name: "乙", author_avatar_path: "/avatar", word_count: "30", unlock_soda_price: "0",
            published_at: "2026-09-07 02:00:00+00", updated_at: "2026-09-07 02:00:00+00",
            sort_at: "2026-09-07 02:00:00+00", tags: [{ id: "4", slug: "fantasy", name: "幻想" }],
          },
          {
            id: "1", slug: "later", title: "候选三", excerpt: "",
            body_markdown: "修仙龍门续篇", paid_body_markdown: "", author_id: "9",
            author_name: "丙", author_avatar_path: null, word_count: "40", unlock_soda_price: "0",
            published_at: "2026-09-07 01:00:00+00", updated_at: "2026-09-07 01:00:00+00",
            sort_at: "2026-09-07 01:00:00+00", tags: [],
          },
        ],
      } as unknown as QueryResult<Row>;
    },
  };
  const result = await searchPostgresOriginalArticles(executor, {
    viewer: null,
    contentQuery: query("修仙 龍門", "content"),
    limit: 1,
  });
  assert.deepEqual(result.items.map((item) => item.slug), ["hit"]);
  assert.deepEqual(result.items[0].tags, [{ id: 4, slug: "fantasy", name: "幻想" }]);
  assert.equal(result.nextCursor?.id, "2");
});

test("original result counts reuse the entitlement and search predicates without paging", async () => {
  let captured: SqlQuery | undefined;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(sql: SqlQuery) {
      captured = sql;
      return {
        command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ total: "27" }],
      } as unknown as QueryResult<Row>;
    },
  };
  const total = await countPostgresOriginalArticles(executor, {
    viewer: { id: 9, role: "user" },
    titleQuery: query("文章", "title"),
  });
  assert.equal(total, 27);
  assert.match(captured?.text || "", /original_purchases access_purchase/u);
  assert.doesNotMatch(captured?.text || "", /ORDER BY|LIMIT|OFFSET/u);
  assert.equal(captured?.values?.includes(9), true);
});

test("original tag counts use the same entitlement predicate as article results", async () => {
  let captured: SqlQuery | undefined;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(sql: SqlQuery) {
      captured = sql;
      return {
        command: "SELECT", rowCount: 1, oid: 0, fields: [],
        rows: [{ id: "2", slug: "essay", name: "随笔", count: "7" }],
      } as unknown as QueryResult<Row>;
    },
  };
  const tags = await listPostgresOriginalSearchTags(executor, { id: 9, role: "user" });
  assert.deepEqual(tags, [{ id: 2, slug: "essay", name: "随笔", count: 7 }]);
  assert.match(captured?.text || "", /original_purchases access_purchase/);
  assert.deepEqual(captured?.values, [9]);
});
