import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { parseSimpleAndSearchQuery, type ParsedSearchQuery } from "@/lib/search-query";
import {
  buildPostgresContentCandidateQuery,
  searchPostgresContent,
} from "./postgres-content-search";

function contentQuery(value: string): ParsedSearchQuery {
  const parsed = parseSimpleAndSearchQuery(value, { mode: "content" });
  if (!parsed.ok) throw new Error("message" in parsed ? parsed.message : "Invalid content query");
  return parsed.query;
}

test("content candidate SQL uses active published generations and indexable nullable Hans predicates", async () => {
  const parsed = parseSimpleAndSearchQuery("繁體龍門 校园");
  if (!parsed.ok) throw new Error(parsed.message);
  const sql = await buildPostgresContentCandidateQuery(parsed.query, {
    sourceId: 2,
    cursor: { mtimeMs: "9223372036854775807", documentId: "9" },
  }, 64);
  assert.match(sql.text, /g\.state = 'published'/);
  assert.match(sql.text, /d\.active_generation = m\.generation/);
  assert.match(sql.text, /matched_docs AS MATERIALIZED/);
  assert.match(sql.text, /FROM novel_content_blocks b WHERE/);
  assert.match(sql.text, /search_text_hans IS NOT NULL AND/);
  assert.doesNotMatch(sql.text, /COALESCE\(b\.search_text_hans|relative_path/iu);
  assert.equal(sql.name, undefined);
  assert.ok(sql.values?.includes("繁体龙门"));
  assert.ok(sql.values?.includes("繁體龍門"));
  assert.doesNotMatch(sql.text, /NOT \(/);
});

test("PostgreSQL content search treats former operator words as literal AND terms", async () => {
  const query = await buildPostgresContentCandidateQuery(contentQuery("修仙 AND 龍門"));
  assert.ok(query.values?.includes("and"));
  assert.doesNotMatch(query.text, /NOT \(/u);
});

test("content search pagination counts the complete result set before applying its offset", async () => {
  const query = await buildPostgresContentCandidateQuery(contentQuery("龍門"), { offset: 40 }, 20);
  assert.match(query.text, /match_counts AS MATERIALIZED \(\s*SELECT COUNT\(\*\)::bigint AS total_items/su);
  assert.match(query.text, /COUNT\(DISTINCT novel_id\)::bigint AS total_novels/su);
  assert.match(query.text, /LIMIT \$\d+ OFFSET \$\d+/u);
  assert.ok(query.values?.includes(40));
  await assert.rejects(buildPostgresContentCandidateQuery(contentQuery("龍門"), {
    offset: 20,
    cursor: { mtimeMs: "20", documentId: "2" },
  }), /cursor and offset/);
});

test("simple AND search emits one index intersection per unique keyword", async () => {
  const parsed = parseSimpleAndSearchQuery("修仙 龍門 修仙");
  if (!parsed.ok) throw new Error(parsed.message);
  const sql = await buildPostgresContentCandidateQuery(parsed.query);
  assert.equal(parsed.query.syntax, "simple-and");
  assert.doesNotMatch(sql.text, /\bOR\s+TRUE|NOT \(/u);
  assert.match(sql.text, /INTERSECT/u);
  assert.match(sql.text, /FROM novel_content_blocks term_block_1/u);
  assert.match(sql.text, /JOIN LATERAL \(\s*SELECT hit\.block_no, hit\.char_start/u);
  assert.ok(sql.values?.includes("修仙"));
  assert.ok(sql.values?.includes("龍門"));
});

test("content search pushes source, title and visibility-aware tag filters into PostgreSQL", async () => {
  const content = parseSimpleAndSearchQuery("修仙 龍門");
  const title = parseSimpleAndSearchQuery("山海 正传", { mode: "title" });
  if (!content.ok) throw new Error(content.message);
  if (!title.ok) throw new Error(title.message);
  const sql = await buildPostgresContentCandidateQuery(content.query, {
    novelId: 42,
    sourceSlug: "Main",
    excludedSourceSlugs: ["archive"],
    includeTagSlugs: ["xuanhuan", "finished"],
    excludeTagSlugs: ["spoiler"],
    titleQuery: title.query,
    audience: "member",
  });
  assert.match(sql.text, /LEFT JOIN novel_sources s/u);
  assert.match(sql.text, /lower\(s\.slug\) =/u);
  assert.match(sql.text, /s\.id IS NULL OR lower\(s\.slug\) <> ALL/u);
  assert.match(sql.text, /n\.id =/u);
  assert.match(sql.text, /title_search_original LIKE/u);
  assert.match(sql.text, /tag\.visibility IN \('public', 'member'\)/u);
  assert.equal((sql.text.match(/SELECT 1 FROM novel_tags tagged/gu) || []).length, 3);
  assert.ok(sql.values?.includes("main"));
  assert.ok(sql.values?.includes("xuanhuan"));
  await assert.rejects(buildPostgresContentCandidateQuery(content.query, {
    cursor: { mtimeMs: "1", documentId: "9223372036854775808" },
  }), /cursor document/);
});

test("content search maps indexed rows without returning private storage paths", async () => {
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(_query: SqlQuery) {
      return {
        command: "SELECT", rowCount: 2, oid: 0, fields: [],
        rows: [
          { document_id: "2", novel_id: 2, chapter_id: null, novel_title: "真结果", chapter_title: null,
            content_version: "sha256:a", mtime_ms: "20", block_no: 0, char_start: 1200,
            blocks: [{ blockNo: 0, originalText: "繁體龍門修仙正傳" }], total_items: "20", total_novels: "12" },
          { document_id: "1", novel_id: 1, chapter_id: null, novel_title: "假候选", chapter_title: null,
            content_version: "sha256:b", mtime_ms: "10", block_no: 0, char_start: 0,
            blocks: [{ blockNo: 0, originalText: "繁體龍門校园" }] },
        ],
      } as unknown as QueryResult<Row>;
    },
  };
  const parsed = parseSimpleAndSearchQuery("繁体龙门 修仙");
  if (!parsed.ok) throw new Error(parsed.message);
  const page = await searchPostgresContent(executor, parsed.query, { limit: 10 });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].novelTitle, "真结果");
  assert.equal(page.items[0].charStart, 1200);
  assert.equal("relativePath" in page.items[0], false);
  assert.equal(page.nextCursor, null);
  assert.equal(page.totalItems, 20);
  assert.equal(page.totalNovels, 12);
});

test("content search returns a snippet window around the first visible match", async () => {
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(_query: SqlQuery) {
      return {
        command: "SELECT", rowCount: 1, oid: 0, fields: [],
        rows: [{
          document_id: "3", novel_id: 3, chapter_id: null, novel_title: "长文", chapter_title: null,
          content_version: "sha256:c", mtime_ms: "30", block_no: 0, char_start: 0,
          blocks: [{ blockNo: 0, originalText: `${"前".repeat(400)}龍門${"后".repeat(400)}` }],
        }],
      } as unknown as QueryResult<Row>;
    },
  };
  const page = await searchPostgresContent(executor, contentQuery("龍門"), { limit: 10 });
  assert.equal(page.items[0].snippet, `...${"前".repeat(24)}龍門${"后".repeat(254)}...`);
});
