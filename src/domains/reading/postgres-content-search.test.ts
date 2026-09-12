import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { parseSimpleAndSearchQuery, type ParsedSearchQuery } from "@/lib/search-query";
import {
  buildContentSearchCandidateQuery,
  buildContentSearchPageQuery,
  planContentSearchTerms,
  searchPostgresContent,
  type ContentSearchTerm,
  type ContentSearchTransaction,
} from "./postgres-content-search";

function parsed(value: string, mode: "content" | "title"): ParsedSearchQuery {
  const result = parseSimpleAndSearchQuery(value, { mode });
  if (!result.ok) throw new Error("message" in result ? result.message : "Invalid query");
  return result.query;
}

const contentQuery = (value: string) => parsed(value, "content");
const titleQuery = (value: string) => parsed(value, "title");

function result<Row extends QueryResultRow>(rows: unknown[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
}

type Statement = { kind: "session" | "candidates" | "page"; query: SqlQuery };

/** Answers the three statements a search issues and records them in order. */
function fakeDatabase(fixture: {
  totalItems: number;
  totalNovels: number;
  ids: string[];
  page?: (ids: string[]) => unknown[];
}) {
  const statements: Statement[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      const text = query.text.trim();
      if (text.startsWith("SELECT set_config('jit'")) {
        statements.push({ kind: "session", query });
        return result<Row>([{}]);
      }
      if (text.startsWith("WITH candidates AS MATERIALIZED")) {
        statements.push({ kind: "candidates", query });
        return result<Row>([{
          total_items: String(fixture.totalItems), total_novels: String(fixture.totalNovels), ids: fixture.ids,
        }]);
      }
      if (text.startsWith("SELECT s.document_id::text AS document_id")) {
        statements.push({ kind: "page", query });
        return result<Row>(fixture.page?.((query.values?.[0] ?? []) as string[]) ?? []);
      }
      throw new Error(`Unexpected SQL: ${text.slice(0, 60)}`);
    },
  } as SqlExecutor;
  const transaction: ContentSearchTransaction = (operation) => operation(executor);
  return { transaction, statements };
}

function pageRow(id: string, text: string) {
  return {
    document_id: id, novel_id: Number(id), chapter_id: null, novel_title: `书${id}`, chapter_title: null,
    content_version: `sha256:${id}`, block_no: 0, blocks: [{ blockNo: 0, charStart: 0, originalText: text }],
  };
}

function count(text: string, pattern: RegExp): number {
  return text.match(new RegExp(pattern.source, "gu"))?.length ?? 0;
}

test("keywords fold to the one indexed form and are classified by how exactly a bigram answers them", async () => {
  const terms = await planContentSearchTerms(contentQuery("修炼 龍門 不可思议 龙门 刀"));
  assert.deepEqual(terms.map(({ text, kind }) => [text, kind]), [
    ["不可思议", "verify"],
    ["修炼", "exact"],
    ["龙门", "exact"],
    ["刀", "unindexed"],
  ], "Traditional and Simplified spellings of one word are one keyword, longest first");
});

test("a query of single characters is refused before it could scan the library", async () => {
  const base = contentQuery("修炼");
  const singles = { ...base, requiredTerms: ["刀", "剑"].map((value) => ({ value, normalized: value, phrase: false as const, exact: false })) };
  await assert.rejects(planContentSearchTerms(singles), /at least two characters/);
});

test("an index-exact search is counted and paged from the index alone, never reading text", async () => {
  const terms = await planContentSearchTerms(contentQuery("修炼 金丹"));
  const query = await buildContentSearchCandidateQuery(terms, { sourceSlug: "default" }, { limit: 20, offset: 40 });
  assert.match(query.text, /^WITH candidates AS MATERIALIZED/u);
  assert.match(query.text, /ORDER BY s\.document_id DESC/u);
  assert.equal(count(query.text, /s\.search_text LIKE '%' \|\| \$\d+ \|\| '%'/u), 2);
  assert.doesNotMatch(query.text, /strpos|LATERAL/u, "two-character keywords are single bigrams: nothing to verify");
  assert.match(query.text, /count\(\*\) FROM candidates/u);
  assert.match(query.text, /count\(DISTINCT novel_id\) FROM candidates/u);
  assert.match(query.text, /FROM candidates c\s+LIMIT \$\d+ OFFSET \$\d+/u);
  assert.ok(query.values?.includes(20) && query.values.includes(40));
});

test("keywords the index can only approximate are verified over ordered candidates, as the page fills", async () => {
  const terms = await planContentSearchTerms(contentQuery("不可思议 刀"));
  const query = await buildContentSearchCandidateQuery(terms, {}, { limit: 20, offset: 0 });
  assert.equal(count(query.text, /s\.search_text LIKE/u), 1, "a single character has no bigram and would only force a sequential scan");
  assert.match(query.text, /FROM candidates c LIMIT \$\d+\s*\)\s*scanned\s+JOIN LATERAL/u,
    "verification hangs off a LATERAL over the ordered tuplestore, so the page limit stops it");
  assert.equal(count(query.text, /strpos\(v\.search_text, \$\d+\) > 0/u), 2);
  assert.ok(query.values?.includes(2_020), "verification may read the page window plus a bounded allowance");
  assert.ok(query.values?.includes("不可思议") && query.values.includes("刀"));
});

test("library, book, tag and title scope filter the search row without joins the planner could reorder", async () => {
  const terms = await planContentSearchTerms(contentQuery("修炼"));
  const query = await buildContentSearchCandidateQuery(terms, {
    sourceSlug: "Default",
    excludedSourceSlugs: ["private"],
    novelId: 7,
    includeTagSlugs: ["xianxia"],
    excludeTagSlugs: ["hidden"],
    titleQuery: titleQuery("凡人 修仙传"),
    audience: "member",
  }, { limit: 20, offset: 0 });
  assert.match(query.text, /s\.novel_id = \$\d+/u);
  assert.match(query.text, /s\.source_id = \(SELECT lookup\.id FROM novel_sources lookup WHERE lower\(lookup\.slug\) = \$\d+\)/u);
  assert.match(query.text, /s\.source_id IS NULL OR s\.source_id <> ALL/u);
  assert.match(query.text, /tag\.visibility IN \('public', 'member'\)/u);
  assert.match(query.text, /NOT EXISTS/u);
  assert.match(query.text, /EXISTS \(SELECT 1 FROM novels n WHERE n\.id = s\.novel_id/u);
  assert.match(query.text, /strpos\(n\.title_search_original, \$\d+\) > 0/u,
    "recheck is off for the whole statement, so a title filter has to verify itself");
  assert.doesNotMatch(query.text, /JOIN novel_documents|JOIN novels/u);
  assert.ok(query.values?.includes("default"));

  const everyLibrary = await buildContentSearchCandidateQuery(terms, { sourceSlug: "all", includeTagSlugs: ["a"], audience: "admin" }, { limit: 20, offset: 0 });
  assert.doesNotMatch(everyLibrary.text, /source_id|tag\.visibility/u);
});

test("LIKE wildcards are escaped for the default escape character, and verified literally", async () => {
  const terms: ContentSearchTerm[] = [{ text: "50%_折\\", length: 6, kind: "verify" }];
  const query = await buildContentSearchCandidateQuery(terms, {}, { limit: 20, offset: 0 });
  assert.ok(query.values?.includes("50\\%\\_折\\\\"));
  assert.ok(query.values?.includes("50%_折\\"));
  assert.doesNotMatch(query.text, /ESCAPE/u);
  await assert.rejects(buildContentSearchCandidateQuery(terms, {}, { limit: 0, offset: 0 }), /limit/);
  await assert.rejects(buildContentSearchCandidateQuery(terms, {}, { limit: 20, offset: -1 }), /offset/);
  await assert.rejects(buildContentSearchCandidateQuery([{ text: "刀", length: 1, kind: "unindexed" }], {}, { limit: 20, offset: 0 }), /two characters/);
});

test("the page statement maps each match back to its block through the stored offsets", () => {
  const query = buildContentSearchPageQuery(["9", "12"], "修炼");
  assert.match(query.text, /unnest\(s\.block_starts\)/u);
  assert.match(query.text, /strpos\(s\.search_text, \$2\)/u);
  assert.match(query.text, /BETWEEN greatest\(located\.block_no - 1, 0\) AND located\.block_no \+ 1/u);
  assert.match(query.text, /WHERE s\.document_id = ANY\(\$1::bigint\[\]\)/u);
  assert.deepEqual(query.values, [["9", "12"], "修炼"]);
  assert.throws(() => buildContentSearchPageQuery([], "修炼"), /at least one document/);
  assert.throws(() => buildContentSearchPageQuery(["0"], "修炼"), /document id/);
  assert.throws(() => buildContentSearchPageQuery(["1; DROP TABLE novels"], "修炼"), /document id/);
});

test("a search is one counted statement and one page statement, in one transaction", async () => {
  const text = "前文。他开始修炼，第三十次。后文";
  const database = fakeDatabase({ totalItems: 45, totalNovels: 44, ids: ["30", "29"], page: (ids) => ids.map((id) => pageRow(id, text)) });
  const page = await searchPostgresContent(database.transaction, contentQuery("修炼"), { page: 3, pageSize: 20 });
  assert.deepEqual(database.statements.map((statement) => statement.kind), ["session", "candidates", "page"]);
  assert.match(database.statements[0].query.text, /set_config\('pg_bigm\.enable_recheck', 'off', true\)/u);
  assert.match(database.statements[0].query.text, /current_setting\('pg_bigm\.enable_recheck', true\) IS NOT NULL/u,
    "a database without pg_bigm skips the setting instead of failing on it");
  assert.ok(database.statements[1].query.values?.includes(40), "page 3 starts after two pages");
  assert.deepEqual(database.statements[2].query.values, [["30", "29"], "修炼"]);
  assert.deepEqual({ totalItems: page.totalItems, totalNovels: page.totalNovels, estimated: page.estimated, page: page.page },
    { totalItems: 45, totalNovels: 44, estimated: false, page: 3 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["30", "29"]);
  const [first] = page.items;
  assert.equal(first.snippet.slice(first.highlightRanges[0].start, first.highlightRanges[0].end), "修炼");
  assert.equal(first.charStart, text.indexOf("修炼"));
});

test("an approximate keyword reports its totals as an upper bound while its rows stay exact", async () => {
  const database = fakeDatabase({ totalItems: 12, totalNovels: 12, ids: ["5"], page: (ids) => ids.map((id) => pageRow(id, "真是不可思议的一天")) });
  const page = await searchPostgresContent(database.transaction, contentQuery("不可思议"), {});
  assert.equal(page.estimated, true);
  assert.equal(page.items.length, 1);
});

test("an empty result never issues the page statement", async () => {
  const database = fakeDatabase({ totalItems: 0, totalNovels: 0, ids: [] });
  const page = await searchPostgresContent(database.transaction, contentQuery("龙傲天"), {});
  assert.deepEqual(database.statements.map((statement) => statement.kind), ["session", "candidates"]);
  assert.deepEqual({ items: page.items, totalItems: page.totalItems }, { items: [], totalItems: 0 });
});

test("the excerpt prefers the occurrence inside the block the match was located in", async () => {
  const database = fakeDatabase({
    totalItems: 1, totalNovels: 1, ids: ["8"],
    page: () => [{
      document_id: "8", novel_id: 8, chapter_id: 3, novel_title: "书", chapter_title: "第一章", content_version: "sha256:8",
      block_no: 1,
      blocks: [
        { blockNo: 0, charStart: 0, originalText: "修炼".padEnd(300, "甲") },
        { blockNo: 1, charStart: 300, originalText: "乙乙修炼乙乙" },
        { blockNo: 2, charStart: 306, originalText: "丙丙丙" },
      ],
    }],
  });
  const [item] = (await searchPostgresContent(database.transaction, contentQuery("修炼"), {})).items;
  assert.deepEqual({ blockNo: item.blockNo, charStart: item.charStart, chapterId: item.chapterId, chapterTitle: item.chapterTitle },
    { blockNo: 1, charStart: 302, chapterId: 3, chapterTitle: "第一章" });
});

test("content search validates pages and page sizes before borrowing a connection", async () => {
  const database = fakeDatabase({ totalItems: 0, totalNovels: 0, ids: [] });
  await assert.rejects(searchPostgresContent(database.transaction, contentQuery("修炼"), { page: 0 }), /page/);
  await assert.rejects(searchPostgresContent(database.transaction, contentQuery("修炼"), { page: 100_001 }), /page/);
  await assert.rejects(searchPostgresContent(database.transaction, contentQuery("修炼"), { pageSize: 0 }), /page size/);
  assert.equal(database.statements.length, 0);
});
