import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { createContentBlocks } from "./content-text";
import {
  contentSearchDocument,
  deleteOrphanedSearchDocuments,
  listStaleSearchDocuments,
  PUBLISHED_DOCUMENT_PREDICATE,
  rebuildContentSearchDocument,
  writeContentSearchDocument,
} from "./postgres-search-index";

function recordingExecutor(rows: unknown[] = []) {
  const queries: SqlQuery[] = [];
  const executor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  } as SqlExecutor;
  return { executor, queries };
}

test("the document form concatenates block search text and records where each block starts", () => {
  assert.deepEqual(contentSearchDocument([{ searchText: "修炼" }, { searchText: "" }, { searchText: "金丹大道" }]), {
    searchText: "修炼金丹大道",
    blockStarts: [0, 2, 2],
  });
});

test("rebuilding from stored display text reproduces exactly what a build writes", async () => {
  const text = "第一章　龍門客棧。他開始修煉，".repeat(300);
  const blocks: { searchText: string }[] = [];
  for await (const block of createContentBlocks(text)) blocks.push(block);
  const rebuilt = await rebuildContentSearchDocument(text);
  assert.deepEqual(rebuilt, contentSearchDocument(blocks));
  assert.equal(rebuilt.blockStarts.length, blocks.length);
  assert.ok(rebuilt.searchText.includes("龙门客栈"), "the indexed form is the Hans one");
});

test("the writer takes a document's novel and library from the document, not from its caller", async () => {
  const { executor, queries } = recordingExecutor();
  await writeContentSearchDocument(executor, "42", 3, { searchText: "修炼", blockStarts: [0] });
  assert.match(queries[0].text, /SELECT d\.id, d\.novel_id, d\.source_id, \$2, \$3::integer\[\], \$4\s+FROM novel_documents d WHERE d\.id = \$1/u);
  assert.match(queries[0].text, /ON CONFLICT \(document_id\) DO UPDATE/u);
  assert.deepEqual(queries[0].values, ["42", 3, [0], "修炼"]);
});

test("stale documents are listed in id order behind a validated cursor", async () => {
  const { executor, queries } = recordingExecutor([{ document_id: "9", generation: 2, block_count: 5 }]);
  assert.deepEqual(await listStaleSearchDocuments(executor, { after: "8", limit: 10 }), [
    { documentId: "9", generation: 2, blockCount: 5 },
  ]);
  assert.match(queries[0].text, /s\.document_id IS NULL/u);
  assert.match(queries[0].text, /ORDER BY d\.id/u);
  assert.ok(queries[0].text.includes(PUBLISHED_DOCUMENT_PREDICATE), "the backfill and the writer agree on what is published");
  assert.deepEqual(queries[0].values, ["8", 10]);
  await assert.rejects(listStaleSearchDocuments(executor, { limit: 0 }), /batch size/);
  await assert.rejects(listStaleSearchDocuments(executor, { after: "x", limit: 1 }), /cursor/);
});

test("orphan cleanup removes rows whose document is no longer published at that generation", async () => {
  const { executor, queries } = recordingExecutor();
  assert.equal(await deleteOrphanedSearchDocuments(executor, 100), 0);
  assert.match(queries[0].text, /d\.active_generation = s2\.generation/u);
  assert.ok(queries[0].text.includes(`NOT (${PUBLISHED_DOCUMENT_PREDICATE})`));
  await assert.rejects(deleteOrphanedSearchDocuments(executor, 0), /batch size/);
});
