import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { parseSimpleAndSearchQuery, type ParsedSearchQuery } from "@/lib/search-query";
import {
  buildContentSearchPageQuery,
  buildContentSearchProbeQuery,
  buildContentSearchStreamQuery,
  planContentSearchTerms,
  searchPostgresContent,
  selectContentSearchAnchors,
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

type StreamFixture = { document_id: string; novel_id: number; mtime_ms: string; matched: boolean };

/** Answers the statements a search issues and records each one by kind. */
function statementTimeout(): Error {
  return Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
}

function fakeDatabase(fixture: {
  counts?: Array<Array<number | null>>;
  stream: StreamFixture[];
  page?: (ids: string[]) => unknown[];
  timeoutOnFetch?: number;
  timeoutOnProbe?: boolean;
  /** The one statement that resolves a whole page of snippets times out. */
  timeoutOnPageBatch?: boolean;
  /** This document times out when the page is retried one document at a time. */
  timeoutOnDocument?: string;
}) {
  const statements: string[] = [];
  let position = 0;
  let probes = 0;
  let fetches = 0;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      const text = query.text.trim();
      if (text.startsWith("SELECT set_config")) {
        statements.push("SET");
        return result<Row>([{}]);
      }
      if (text.startsWith("SELECT ARRAY[")) {
        statements.push("PROBE");
        if (fixture.timeoutOnProbe) throw statementTimeout();
        return result<Row>([{ counts: fixture.counts?.[probes++] }]);
      }
      const keyword = /^(SAVEPOINT|RELEASE|ROLLBACK|CLOSE|DECLARE|FETCH)\b/u.exec(text)?.[1];
      if (keyword) statements.push(keyword);
      if (keyword === "DECLARE") position = 0;
      if (keyword === "FETCH") {
        fetches += 1;
        if (fixture.timeoutOnFetch === fetches) {
          throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
        }
        const size = Number(/^FETCH (\d+)/u.exec(text)?.[1]);
        const rows = fixture.stream.slice(position, position + size);
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
  return { transaction, statements };
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

test("the probe counts index candidates per term without reading block text", async () => {
  const terms = await planContentSearchTerms(contentQuery("龍門 一个人 他"));
  const probe = buildContentSearchProbeQuery(terms, [50_000, 400_000, 1]);
  assert.match(probe.text, /^SELECT ARRAY\[/u);
  assert.equal((probe.text.match(/LIMIT \$\d+\b/gu) || []).length, 2);
  assert.match(probe.text, /NULL::integer/u, "a single character has no bigram to count");
  assert.match(probe.text, /search_text_hans IS NOT NULL AND/u);
  assert.doesNotMatch(probe.text, /strpos|original_text/u);
  assert.ok(probe.values?.includes(50_000) && probe.values?.includes(400_000));
  for (const gram of ["一个", "个人", "龍門", "龙门"]) assert.ok(probe.values?.includes(gram));
  assert.doesNotMatch(probe.text, /龍|龙|个/u, "keywords are bound, never interpolated");
  assert.throws(() => buildContentSearchProbeQuery(terms, [1]), /probe caps/);
});

test("exact terms anchor far longer than verified ones and the smallest candidate set leads", async () => {
  // Terms sort longest first: [一个人 (verify), 龍門 (exact), 他 (unindexed)].
  const terms = await planContentSearchTerms(contentQuery("龍門 一个人 他"));
  assert.deepEqual(selectContentSearchAnchors(terms, [60_000, 300_000, null]), [1], "only the exact term is under its cap");
  assert.deepEqual(selectContentSearchAnchors(terms, [40_000, 30_000, null]), [1, 0], "a second small anchor joins the smallest");
  assert.deepEqual(selectContentSearchAnchors(terms, [40_000, 300_000, null]), [0], "a large exact set does not join a small one");
  assert.deepEqual(selectContentSearchAnchors(terms, [50_000, 400_000, null]), [], "no term is under its cap");
});

test("anchored streams check long keywords only on candidate blocks and never re-enter the index", async () => {
  const terms = await planContentSearchTerms(contentQuery("是他了 修炼 他"));
  const sql = await buildContentSearchStreamQuery(terms, { kind: "anchored", anchors: [0] }, { maxResults: 1_000 });
  assert.match(sql.text, /WITH anchor_0 AS MATERIALIZED/u);
  assert.match(sql.text, /array_agg\(b\.block_no ORDER BY b\.block_no\) AS blocks/u);
  assert.match(sql.text, /unnest\(a0\.blocks\) AS candidate\(block_no\)/u);
  assert.match(sql.text, /JOIN novel_documents d ON d\.id = a0\.document_id AND d\.active_generation = a0\.generation/u);
  const verification = sql.text.slice(sql.text.indexOf("SELECT d.id::text"), sql.text.indexOf("AS matched"));
  assert.equal((verification.match(/strpos\(v\.search_text_original/gu) || []).length, 3);
  assert.doesNotMatch(verification, /LIKE/u, "per-document checks are exact containment");
  assert.match(sql.text, /g\.state = 'published'/u);
  assert.match(sql.text, /ORDER BY n\.mtime_ms DESC, d\.id DESC$/u);
  assert.doesNotMatch(sql.text, /是他|修炼/u);
});

test("walks push scope filters into PostgreSQL and continue from a keyset cursor", async () => {
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
    cursor: { mtimeMs: "20", documentId: "2", shown: 20 },
  });
  assert.doesNotMatch(sql.text, /anchor_/u);
  assert.match(sql.text, /FROM novel_documents d/u);
  assert.match(sql.text, /lower\(s\.slug\) =/u);
  assert.match(sql.text, /s\.id IS NULL OR lower\(s\.slug\) <> ALL/u);
  assert.match(sql.text, /n\.id =/u);
  assert.match(sql.text, /title_search_original LIKE/u);
  assert.match(sql.text, /tag\.visibility IN \('public', 'member'\)/u);
  assert.equal((sql.text.match(/SELECT 1 FROM novel_tags tagged/gu) || []).length, 3);
  assert.match(sql.text, /\(n\.mtime_ms, d\.id\) < \(\$\d+::bigint, \$\d+::bigint\)/u);
  assert.ok(sql.values?.includes("main"));
  assert.doesNotMatch(sql.text, /修仙|龍門|山海/u);
  await assert.rejects(buildContentSearchStreamQuery(terms, { kind: "walk" }, {
    maxResults: 1_000,
    cursor: { mtimeMs: "1", documentId: "9223372036854775808", shown: 0 },
  }), /cursor document/);
  await assert.rejects(buildContentSearchStreamQuery(terms, { kind: "anchored", anchors: [5] }, { maxResults: 1_000 }), /anchor/);
});

test("result pages resolve each document's snippet block in listed order", async () => {
  const terms = await planContentSearchTerms(contentQuery("龍門"));
  const sql = buildContentSearchPageQuery(terms, ["9", "3"]);
  assert.match(sql.text, /unnest\(\$1::bigint\[\]\) WITH ORDINALITY AS page/u);
  assert.match(sql.text, /strpos\(hit\.search_text_original/u);
  assert.match(sql.text, /ORDER BY page\.ordinality$/u);
  assert.deepEqual(sql.values?.[0], ["9", "3"]);
  assert.throws(() => buildContentSearchPageQuery(terms, ["1; DROP"]), /page documents/);
});

test("capped searches list the newest matches, report the cap and page from one cached list", async () => {
  const stream: StreamFixture[] = [
    { document_id: "5", novel_id: 1, mtime_ms: "50", matched: true },
    { document_id: "4", novel_id: 1, mtime_ms: "40", matched: false },
    // A second chapter of the same novel: documents are listed, novels are counted once.
    { document_id: "3", novel_id: 1, mtime_ms: "30", matched: true },
    { document_id: "2", novel_id: 3, mtime_ms: "20", matched: true },
    { document_id: "1", novel_id: 4, mtime_ms: "10", matched: true },
  ];
  const database = fakeDatabase({
    counts: [[12]],
    stream,
    page: (ids) => ids.map((id) => pageRow(id, `第${id}章 龍门出现在这里`)),
  });
  const first = await searchPostgresContent(database.transaction, contentQuery("龍門"), { maxResults: 3, pageSize: 2 });
  assert.deepEqual(first.items.map((item) => item.documentId), ["5", "3"]);
  assert.equal(first.totalItems, 3);
  assert.equal(first.totalNovels, 2);
  assert.equal(first.capped, true, "a fourth match exists beyond the cap");
  assert.equal(first.partial, false);
  assert.equal(first.nextCursor, null);
  assert.deepEqual(first.items[0].highlightRanges.map((range) => first.items[0].snippet.slice(range.start, range.end)), ["龍门"]);
  assert.deepEqual(database.statements.filter((statement) => ["PROBE", "DECLARE", "PAGE"].includes(statement)), ["PROBE", "DECLARE", "PAGE"]);

  const before = database.statements.length;
  const second = await searchPostgresContent(database.transaction, contentQuery("龍門"), { maxResults: 3, pageSize: 2, page: 2 });
  assert.deepEqual(second.items.map((item) => item.documentId), ["2"]);
  assert.equal(second.totalItems, 3);
  assert.equal(second.capped, true);
  const later = database.statements.slice(before);
  assert.ok(!later.includes("PROBE") && !later.includes("DECLARE") && !later.includes("FETCH"), "the second page reuses the list");
  assert.ok(later.includes("PAGE"));
});

test("in-book searches walk the book's documents without probing the index", async () => {
  const database = fakeDatabase({
    stream: [{ document_id: "8", novel_id: 101, mtime_ms: "5", matched: true }],
    page: (ids) => ids.map((id) => pageRow(id, "他知道一切")),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("知道"), { maxResults: 1_000, novelId: 101 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["8"]);
  assert.equal(page.totalItems, 1);
  assert.equal(page.capped, false);
  assert.ok(!database.statements.includes("PROBE"));
  assert.equal(database.statements.filter((statement) => statement === "FETCH").length, 1);
});

test("a search that exhausts its budget returns the ordered prefix it found and a cursor", async () => {
  const stream: StreamFixture[] = Array.from({ length: 600 }, (_, index) => ({
    document_id: String(600 - index),
    novel_id: 600 - index,
    mtime_ms: String(10_000 - index),
    matched: index % 20 === 0,
  }));
  const database = fakeDatabase({
    // At its cap, so this dense exact term takes the walk plan.
    counts: [[400_000]],
    stream,
    timeoutOnFetch: 2,
    page: (ids) => ids.map((id) => pageRow(id, "修炼之路")),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("修炼"), { maxResults: 1_000, pageSize: 5 });
  assert.equal(page.partial, true);
  assert.equal(page.totalItems, null);
  assert.equal(page.totalNovels, null);
  assert.deepEqual(page.items.map((item) => item.documentId), ["600", "580", "560", "540", "520"]);
  assert.deepEqual(page.nextCursor, { mtimeMs: "9920", documentId: "520", shown: 5 });
  assert.ok(database.statements.includes("ROLLBACK"), "the timed-out cursor is rolled back to its savepoint");

  const done = await searchPostgresContent(fakeDatabase({ stream: [] }).transaction, contentQuery("修炼"), {
    maxResults: 5,
    pageSize: 5,
    cursor: { mtimeMs: "9920", documentId: "520", shown: 5 },
  });
  assert.deepEqual(done.items, []);
  assert.equal(done.nextCursor, null, "a cursor cannot page past the result cap");
});

test("a probe that outlasts its budget falls back to a walk instead of failing the search", async () => {
  const database = fakeDatabase({
    timeoutOnProbe: true,
    stream: [
      { document_id: "7", novel_id: 7, mtime_ms: "70", matched: true },
      { document_id: "6", novel_id: 6, mtime_ms: "60", matched: true },
    ],
    page: (ids) => ids.map((id) => pageRow(id, "他开始修炼")),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("修炼"), { maxResults: 1_000 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["7", "6"]);
  assert.equal(page.partial, false);
  const statements = database.statements.filter((statement) => ["SAVEPOINT", "PROBE", "ROLLBACK", "DECLARE"].includes(statement));
  assert.deepEqual(statements.slice(0, 4), ["SAVEPOINT", "PROBE", "ROLLBACK", "SAVEPOINT"],
    "the timed-out probe is rolled back to its own savepoint before the walk starts");
  assert.ok(statements.includes("DECLARE"));
});

test("a budget that expires before the first match continues from where the walk reached", async () => {
  // Every document is checked and none matches, so the prefix carries no result to
  // continue from; only the scan position keeps the next request moving forward.
  const database = fakeDatabase({
    counts: [[400_000]],
    stream: Array.from({ length: 600 }, (_, index) => ({
      document_id: String(600 - index),
      novel_id: 600 - index,
      mtime_ms: String(10_000 - index),
      matched: false,
    })),
    timeoutOnFetch: 2,
  });
  // Its own keyword: a complete list is cached per keyword, and another test's list
  // would answer this one from that cache instead of streaming.
  const page = await searchPostgresContent(database.transaction, contentQuery("潜行"), { maxResults: 1_000, pageSize: 20 });
  assert.deepEqual(page.items, []);
  assert.equal(page.partial, true);
  assert.deepEqual(page.nextCursor, { mtimeMs: "9745", documentId: "345", shown: 0 },
    "the cursor is the last document the timed-out walk scanned, not the newest one");
});

test("a page of snippets that times out is resolved one document at a time", async () => {
  const database = fakeDatabase({
    counts: [[12]],
    stream: [
      { document_id: "9", novel_id: 9, mtime_ms: "90", matched: true },
      { document_id: "8", novel_id: 8, mtime_ms: "80", matched: true },
      { document_id: "7", novel_id: 7, mtime_ms: "70", matched: true },
    ],
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
    counts: [[12]],
    stream: [
      { document_id: "9", novel_id: 9, mtime_ms: "90", matched: true },
      { document_id: "8", novel_id: 8, mtime_ms: "80", matched: true },
    ],
    timeoutOnPageBatch: true,
    timeoutOnDocument: "8",
    page: (ids) => ids.map((id) => pageRow(id, `第${id}章 航线在此`)),
  });
  const page = await searchPostgresContent(database.transaction, contentQuery("航线"), { maxResults: 1_000, pageSize: 20 });
  assert.deepEqual(page.items.map((item) => item.documentId), ["9"]);
  assert.equal(page.totalItems, 2, "the match itself still counts; only its snippet was unavailable");
});

test("content search rejects invalid caps, pages and cursor combinations", async () => {
  const { transaction } = fakeDatabase({ stream: [] });
  await assert.rejects(searchPostgresContent(transaction, contentQuery("龍門"), { maxResults: 0 }), /result cap/);
  await assert.rejects(searchPostgresContent(transaction, contentQuery("龍門"), { maxResults: 10, page: 0 }), /page/);
  await assert.rejects(searchPostgresContent(transaction, contentQuery("龍門"), {
    maxResults: 10,
    page: 2,
    cursor: { mtimeMs: "1", documentId: "1", shown: 20 },
  }), /cannot be combined/);
});
