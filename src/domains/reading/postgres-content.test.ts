import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { cleanupRetiredContentGenerations, ContentNotPublishedError, readPublishedNovelContent } from "./postgres-content";

function executorWithRows(rows: QueryResultRow[], captured: SqlQuery[] = []): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

const publishedManifest = {
  id: "14",
  active_content_version: "sha256:v2",
  active_generation: 3,
  published_content_version: "sha256:v2",
  total_utf16_length: 10,
  block_count: 2,
};

const publishedRows = [
  { ...publishedManifest, block_no: 0, char_start: 0, char_end: 6, original_text: "甲乙丙丁戊己" },
  { ...publishedManifest, block_no: 1, char_start: 6, char_end: 10, original_text: "庚辛壬癸" },
];

test("published reader content resolves an owner and preserves one-version ordering", async () => {
  const captured: SqlQuery[] = [];
  const content = await readPublishedNovelContent(executorWithRows(publishedRows, captured), {
    novelId: 7,
    chapterId: 9,
  });
  assert.equal(content.documentId, "14");
  assert.equal(content.contentVersion, "sha256:v2");
  assert.deepEqual(content.blocks.map((block) => block.blockNo), [0, 1]);
  assert.deepEqual(captured[0].values, [7, 9, 1]);
  assert.match(captured[0].text, /d\.chapter_id IS NOT DISTINCT FROM \$2::integer/);
  assert.match(captured[0].text, /block\.generation = d\.active_generation/);
  assert.doesNotMatch(captured[0].text, /jsonb_agg/u);
});

test("paid preview is clipped at the database-bounded UTF-16 cutoff", async () => {
  const captured: SqlQuery[] = [];
  const content = await readPublishedNovelContent(executorWithRows(publishedRows, captured), {
    novelId: 7,
    previewRatio: 0.3,
  });
  assert.equal(content.totalUtf16Length, 3);
  assert.equal(content.blockCount, 1);
  assert.deepEqual(content.blocks, [{ blockNo: 0, charStart: 0, charEnd: 3, originalText: "甲乙丙" }]);
  assert.deepEqual(captured[0].values, [7, null, 0.3]);
  assert.match(captured[0].text, /block\.char_start < ceil/);
});

test("retired generations are reclaimed through the manifest by key prefix, never by scanning blocks", async () => {
  const captured: SqlQuery[] = [];
  const deleted = await cleanupRetiredContentGenerations(executorWithRows([{ blocks: "130", generations: "2" }], captured), 32);
  assert.deepEqual(deleted, { blocksDeleted: 130, generationsDeleted: 2 });
  assert.deepEqual(captured[0].values, [32]);
  const [victims, deletes] = captured[0].text.split("deleted_blocks AS");
  assert.match(victims, /FROM novel_content_generations g/);
  assert.doesNotMatch(victims, /novel_content_blocks/, "victims are chosen without reading block rows");
  assert.match(victims, /g\.state IN \('obsolete', 'failed'\)/);
  assert.match(victims, /IS DISTINCT FROM d\.staging_generation/, "an in-progress build is never reclaimed");
  assert.match(victims, /FOR UPDATE OF g SKIP LOCKED/);
  assert.match(deletes, /b\.document_id = v\.document_id AND b\.generation = v\.generation/);
  await assert.rejects(cleanupRetiredContentGenerations(executorWithRows([]), 0), /cleanup budget/);
});

test("published reader content fails closed for invalid owners and incomplete manifests", async () => {
  await assert.rejects(readPublishedNovelContent(executorWithRows([]), { novelId: 0 }), /owner/);
  await assert.rejects(readPublishedNovelContent(executorWithRows([]), { novelId: 1, previewRatio: 0 }), /preview ratio/);
  await assert.rejects(
    readPublishedNovelContent(executorWithRows([{ ...publishedRows[0], active_content_version: "stale" }]), { novelId: 1 }),
    ContentNotPublishedError,
  );
});
