import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { parseSimpleAndSearchQuery, type ParsedSearchQuery } from "@/lib/search-query";
import {
  buildContentSearchPageQuery,
  buildContentSearchStreamQuery,
  canAnchorContentSearch,
  planContentSearchTerms,
  searchPostgresContent,
  type ContentSearchTerm,
  type ContentSearchTransaction,
} from "./postgres-content-search";

function contentQuery(value: string): ParsedSearchQuery {
  const parsed = parseSimpleAndSearchQuery(value, { mode: "content" });
  if (!parsed.ok) throw new Error("message" in parsed ? parsed.message : "Invalid content query");
  return parsed.query;
}

function result<Row extends QueryResultRow>(rows: unknown[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
}

/** Only matches reach the driver now: the keywords are tested in WHERE. */
type StreamFixture = { document_id: string; novel_id: number };

function statementTimeout(): Error {
  return Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
}

/** Answers the statements a search issues, recording each one by kind and noting which
 *  plan every scan was declared with. */
function fakeDatabase(fixture: {
  /** Rows for each successive scan, in declaration order. */
  scans: StreamFixture[][];
  page?: (ids: string[]) => unknown[];
  /** Ordinals of the FETCH statements that run out of time. */
  timeoutOnFetch?: readonly number[];
  /** The one statement that resolves a whole page of snippets times out. */
  timeoutOnPageBatch?: boolean;
  /** This document times out when the page is retried one document at a time. */
  timeoutOnDocument?: string;
}) {
  const statements: string[] = [];
  const plans: Array<"walk" | "anchored"> = [];
  let scan = -1;
  let position = 0;
  let fetches = 0;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      const text = query.text.trim();
      if (text.startsWith("SELECT set_config")) {
        statements.push("SET");
        return result<Row>([{}]);
      }
      const keyword = /^(SAVEPOINT|RELEASE|ROLLBACK|CLOSE|DECLARE|FETCH)\b/u.exec(text)?.[1];
      if (keyword) statements.push(keyword);
      if (keyword === "DECLARE") {
        scan += 1;
        position = 0;
        plans.push(/WITH anchor AS MATERIALIZED/u.test(text) ? "anchored" : "walk");
      }
      if (keyword === "FETCH") {
        fetches += 1;
        if (fixture.timeoutOnFetch?.includes(fetches)) throw statementTimeout();
        const size = Number(/^FETCH (\d+)/u.exec(text)?.[1]);
        const rows = (fixture.scans[scan] ?? []).slice(position, position + size);
        position += rows.length;
        return result<Row>(rows);
      }
      if (keyword) return result<Row>([]);
      if (text.includes("WITH ORDINALITY AS page")) {
        statements.push("PAGE");
        // The whole-page statement lists every document; a retry lists exactly one.
        const ids = (query.values?.[0] as string[]) ?? [];
        if (fixture.timeoutOnPageBatch && ids.length > 1) throw statementTimeout();
        if (fixture.timeoutOnDocument !== undefined && ids.length === 1 && ids[0] === fixture.timeoutOnDocument) {
          throw statementTimeout();
        }
        return result<Row>(fixture.page?.(ids) ?? []);
      }
      throw new Error(`Unexpected SQL: ${text.slice(0, 60)}`);
    },
  };
  const transaction: ContentSearchTransaction = (operation) => operation(executor);
  return { transaction, statements, plans };
}

function pageRow(id: string, text: string, charStart = 0) {
  return {
    document_id: id, novel_id: Number(id), chapter_id: null, novel_title: `书${id}`, chapter_title: null,
    content_version: `sha256:${id}`, block_no: 0, char_start: charStart,
    blocks: [{ blockNo: 0, charStart, originalText: text }],
  };
}

test("search terms are classified by how exactly the bigram index can answer them", async () => {
  const terms = await planContentSearchTerms(contentQuery("修仙 龍門 一个人 他"));
  assert.deepEqual(terms.map((term) => [term.kind, term.forms.map((form) => form.text)]), [
    ["verify", ["一个人"]],
    ["exact", ["修仙"]],
    ["exact", ["龍門", "龙门"]],
    ["unindexed", ["他"]],
  ]);
  assert.deepEqual(terms[0].forms[0].bigrams, ["一个", "个人"]);
});

test("only the longest keyword anchors, and only where the index can narrow anything", async () => {
  const indexed = await planContentSearchTerms(contentQuery("一个人 修仙 他"));
  assert.equal(indexed[0].kind, "verify", "the longest keyword leads");
  assert.equal(canAnchorContentSearch(indexed, { maxResults: 10 }), true);
  assert.equal(canAnchorContentSearch(indexed, { maxResults: 10, novelId: 7 }), false,
    "one book has too few documents for an index lookup to beat reading them");
  const single: ContentSearchTerm[] = [{ kind: "unindexed", forms: [{ text: "他", bigrams: [] }], length: 1 }];
  assert.equal(canAnchorContentSearch(single, { maxResults: 10 }), false, "a single character has no bigram");
  assert.equal(canAnchorContentSearch([], { maxResults: 10 }), false);
});

test("walks read documents in key order, stop at the limit and push scope into PostgreSQL", async () => {
  const title = parseSimpleAndSearchQuery("山海 正传", { mode: "title" });
  if (!title.ok) throw new Error(title.message);
  const terms = await planContentSearchTerms(contentQuery("修仙 龍門"));
  const sql = await buildContentSearchStreamQuery(terms, { kind: "walk" }, {
    maxResults: 1_000,
    novelId: 42,
    sourceSlug: "Main",
    excludedSourceSlugs: ["archive"],
    includeTagSlugs: ["xuanhuan", "finished"],
    excludeTagSlugs: ["spoiler"],
    titleQuery: title.query,
    audience: "member",
  }, 101, "5000");
  assert.doesNotMatch(sql.text, /anchor/u);
  assert.match(sql.text, /FROM novel_documents d\n/u);
  assert.match(sql.text, /d\.id < \$\d+::bigint/u, "the scan resumes below the last listed document");
  assert.match(sql.text, /ORDER BY d\.id DESC\n\s+LIMIT \$\d+::integer$/u);
  assert.doesNotMatch(sql.text, /mtime_ms/u, "nothing is ranked by time any more");
  // Every other relation is reached through a subquery, so PostgreSQL has no join to
  // reorder and cannot answer the ordering with a sort over the whole library.
  assert.doesNotMatch(sql.text.slice(0, sql.text.indexOf("WHERE")), /JOIN/u);
  assert.match(sql.text, /lower\(s\.slug\) =/u);
  assert.match(sql.text, /s\.id IS NULL OR lower\(s\.slug\) <> ALL/u);
  assert.match(sql.text, /title_search_original LIKE/u);
  assert.match(sql.text, /tag\.visibility IN \('public', 'member'\)/u);
  assert.equal((sql.text.match(/SELECT 1 FROM novel_tags tagged/gu) || []).length, 3);
  assert.match(sql.text, /g\.state = 'published'/u);
  assert.ok(sql.values?.includes("main") && sql.values?.includes(101));
  assert.doesNotMatch(sql.text, /修仙|龍門|山海/u, "keywords are bound, never interpolated");
});

test("anchored scans drive the limit from ordered index candidates, not from a sort", async () => {
  const terms = await planContentSearchTerms(contentQuery("是他了 修炼 他"));
  const sql = await buildContentSearchStreamQuery(terms, { kind: "anchored" }, { maxResults: 1_000 }, 41, "900");
  assert.match(sql.text, /WITH anchor AS MATERIALIZED/u);
  assert.match(sql.text, /array_agg\(b\.block_no ORDER BY b\.block_no\) AS blocks/u);
  assert.match(sql.text, /b\.document_id < \$\d+::bigint/u, "the position narrows the candidate blocks themselves");
  assert.match(sql.text, /GROUP BY b\.document_id, b\.generation\n\s+ORDER BY b\.document_id DESC/u);
  assert.match(sql.text, /JOIN LATERAL \(/u, "LATERAL keeps the candidates' order as the result order");
  assert.match(sql.text, /unnest\(a\.blocks\) AS candidate\(block_no\)/u);
  assert.doesNotMatch(sql.text, /ORDER BY d\.id/u, "a sort here would have to verify every candidate first");
  assert.match(sql.text, /LIMIT \$\d+::integer$/u);
  const verification = sql.text.slice(sql.text.indexOf("JOIN LATERAL"));
  assert.equal((verification.match(/strpos\(v\.search_text_original/gu) || []).length, 3);
  assert.doesNotMatch(verification, /LIKE/u, "per-document checks are exact containment");
  assert.doesNotMatch(sql.text, /是他|修炼/u);

  await assert.rejects(buildContentSearchStreamQuery(terms, { kind: "anchored" }, { maxResults: 10, novelId: 3 }, 10), /anchor/);
  await assert.rejects(buildContentSearchStreamQuery(terms, { kind: "walk" }, { maxResults: 10 }, 10, "0"), /position/);
  await assert.rejects(buildContentSearchStreamQuery(terms, { kind: "walk" }, { maxResults: 10 }, 0), /limit/);
});

test("result pages resolve each document's snippet block in listed order", async () => {
  const terms = await planContentSearchTerms(contentQuery("龍門"));
  const sql = buildContentSearchPageQuery(terms, ["9", "3"]);
  assert.match(sql.text, /unnest\(\$1::bigint\[\]\) WITH ORDINALITY AS page/u);
  assert.match(sql.text, /strpos\(hit\.search_text_original/u);
  assert.match(sql.text, /ORDER BY page\.ordinality$/u);
  assert.deepEqual(sql.values?.[0], ["9", "3"]);
  assert.throws(() => buildContentSearchPageQuery(terms, ["1; DROP"]), /page documents/);
  // A single character has no bigram, but containment still locates it perfectly well.
  const single: ContentSearchTerm[] = [{ kind: "unindexed", forms: [{ text: "他", bigrams: [] }], length: 1 }];
  assert.doesNotThrow(() => buildContentSearchPageQuery(single, ["4"]));
});

test("capped searches report the cap and page from one cached list", async () => {
  const database = fakeDatabase({
    scans: [[
      { document_id: "5", novel_id: 1 },
      // A second chapter of the same novel: documents are listed, novels are counted once.
      { document_id: "3", novel_id: 1 },
      { document_id: "2", novel_id: 3 },
      { document_id: "1", novel_id: 4 },
    ]],
    page: (ids) => ids.map((id) => pageRow(id, `第${id}章 龍门出现在这里`)),
  });
  const first = await searchPostgresContent(database.transaction, contentQuery("龍門"), { maxResults: 3, pageSize: 2 });
  assert.deepEqual(first.items.map((item) => item.documentId), ["5", "3"]);
  assert.equal(first.totalItems, 3);
  assert.equal(first.totalNovels, 2);
  assert.equal(first.capped, true, "a fourth match exists beyond the cap");
  assert.equal(first.partial, false);
  assert.deepEqual(first.items[0].highlightRanges.map((range) => first.items[0].snippet.slice(range.start, range.end)), ["龍门"]);
  assert.deepEqual(database.plans, ["walk"], "no measurement runs before the scan");

  const before = database.statements.length;
  const second = await searchPostgresContent(database.transaction, contentQuery("龍門"), { maxResults: 3, pageSize: 2, page: 2 });
  assert.deepEqual(second.items.map((item) => item.documentId), ["2"]);
  assert.equal(second.totalItems, 3);
  assert.equal(second.capped, true);
  const later = database.statements.slice(before);
  assert.ok(!later.includes("DECLARE") && !later.includes("FETCH"), "the second page reuses the list");
  assert.ok(later.includes("PAGE"));
});

test("in-book searches read the book's documents and never consult the index", async () => {
  const database = fakeDatabase({
    scans: [[{ document_id: "8", novel_id: 101 }]],
    page: (ids) => ids.map((id) => pageRow(id, "他知道一切")),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("知道"), { maxResults: 1_000, novelId: 101 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["8"]);
  assert.equal(page.totalItems, 1);
  assert.equal(page.capped, false);
  assert.deepEqual(database.plans, ["walk"]);
  assert.equal(database.statements.filter((statement) => statement === "FETCH").length, 1);
});

test("a walk that finds nothing hands the rest of the search to the index", async () => {
  const database = fakeDatabase({
    // The walk's first batch times out having listed nothing, so there is no rate to
    // project and the anchored scan takes over.
    timeoutOnFetch: [1],
    scans: [[], [{ document_id: "7", novel_id: 7 }, { document_id: "6", novel_id: 6 }]],
    page: (ids) => ids.map((id) => pageRow(id, "他开始修炼")),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("修炼"), { maxResults: 1_000 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["7", "6"]);
  assert.equal(page.partial, false);
  assert.deepEqual(database.plans, ["walk", "anchored"]);
  assert.ok(database.statements.includes("ROLLBACK"), "the timed-out scan is rolled back to its savepoint");
});

test("a productive walk keeps walking instead of paying for the index", async () => {
  const found = Array.from({ length: 256 }, (_, index) => ({ document_id: String(600 - index), novel_id: 600 - index }));
  const database = fakeDatabase({
    // The first batch lists a full 256 matches, then the second runs out of time: at that
    // rate the walk finishes well inside the budget, so it simply resumes.
    timeoutOnFetch: [2],
    scans: [found, [{ document_id: "10", novel_id: 10 }]],
    page: (ids) => ids.map((id) => pageRow(id, "剑气之路")),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("剑气"), { maxResults: 1_000, pageSize: 3 });
  assert.deepEqual(database.plans, ["walk", "walk"]);
  assert.equal(page.totalItems, 257);
  assert.equal(page.partial, false);
  assert.deepEqual(page.items.map((item) => item.documentId), ["600", "599", "598"]);
});

test("a search that exhausts its budget lists the prefix it found and says so", async () => {
  const database = fakeDatabase({
    timeoutOnFetch: [1, 2],
    scans: [[], []],
    page: (ids) => ids.map((id) => pageRow(id, "潜行之术")),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("潜行"), { maxResults: 1_000, pageSize: 20 });
  assert.deepEqual(page.items, []);
  assert.equal(page.totalItems, 0);
  assert.equal(page.partial, true, "both scans ran out of time, so more matches may exist");
  assert.equal(page.capped, false);
});

test("a page of snippets that times out is resolved one document at a time", async () => {
  const database = fakeDatabase({
    scans: [[
      { document_id: "9", novel_id: 9 },
      { document_id: "8", novel_id: 8 },
      { document_id: "7", novel_id: 7 },
    ]],
    timeoutOnPageBatch: true,
    page: (ids) => ids.map((id) => pageRow(id, `第${id}章 灯塔在此`)),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("灯塔"), { maxResults: 1_000, pageSize: 20 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["9", "8", "7"], "listed order survives the retry");
  assert.equal(page.totalItems, 3);
  assert.equal(database.statements.filter((statement) => statement === "PAGE").length, 4,
    "one page statement, then one per document");
});

test("a document whose snippet times out is skipped instead of failing the page", async () => {
  const database = fakeDatabase({
    scans: [[{ document_id: "9", novel_id: 9 }, { document_id: "8", novel_id: 8 }]],
    timeoutOnPageBatch: true,
    timeoutOnDocument: "8",
    page: (ids) => ids.map((id) => pageRow(id, `第${id}章 航线在此`)),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("航线"), { maxResults: 1_000, pageSize: 20 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["9"]);
  assert.equal(page.totalItems, 2, "the match itself still counts; only its snippet was unavailable");
});

test("content search rejects invalid caps and pages", async () => {
  const { transaction } = fakeDatabase({ scans: [[]] });
  await assert.rejects(searchPostgresContent(transaction, contentQuery("龍門"), { maxResults: 0 }), /result cap/);
  await assert.rejects(searchPostgresContent(transaction, contentQuery("龍門"), { maxResults: 10, page: 0 }), /page/);
  await assert.rejects(searchPostgresContent(transaction, contentQuery("龍門"), { maxResults: 10, pageSize: 0 }), /page size/);
});
