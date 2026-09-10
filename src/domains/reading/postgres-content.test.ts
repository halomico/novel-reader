import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { ContentNotPublishedError, readPublishedNovelContent } from "./postgres-content";

function executorWithRows(rows: QueryResultRow[], captured: SqlQuery[] = []): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

const publishedRow = {
  id: "14",
  active_content_version: "sha256:v2",
  active_generation: 3,
  published_content_version: "sha256:v2",
  total_utf16_length: 10,
  block_count: 2,
  blocks: [
    { blockNo: 0, charStart: 0, charEnd: 6, originalText: "甲乙丙丁戊己" },
    { blockNo: 1, charStart: 6, charEnd: 10, originalText: "庚辛壬癸" },
  ],
};

test("published reader content resolves an owner and preserves one-version ordering", async () => {
  const captured: SqlQuery[] = [];
  const content = await readPublishedNovelContent(executorWithRows([publishedRow], captured), {
    novelId: 7,
    chapterId: 9,
  });
  assert.equal(content.documentId, "14");
  assert.equal(content.contentVersion, "sha256:v2");
  assert.deepEqual(content.blocks.map((block) => block.blockNo), [0, 1]);
  assert.deepEqual(captured[0].values, [7, 9, 1]);
  assert.match(captured[0].text, /d\.chapter_id IS NOT DISTINCT FROM \$2::integer/);
  assert.match(captured[0].text, /b\.generation = d\.active_generation/);
});

test("paid preview is clipped at the database-bounded UTF-16 cutoff", async () => {
  const captured: SqlQuery[] = [];
  const content = await readPublishedNovelContent(executorWithRows([publishedRow], captured), {
    novelId: 7,
    previewRatio: 0.3,
  });
  assert.equal(content.totalUtf16Length, 3);
  assert.equal(content.blockCount, 1);
  assert.deepEqual(content.blocks, [{ blockNo: 0, charStart: 0, charEnd: 3, originalText: "甲乙丙" }]);
  assert.deepEqual(captured[0].values, [7, null, 0.3]);
  assert.match(captured[0].text, /b\.char_start < ceil/);
});

test("published reader content fails closed for invalid owners and incomplete manifests", async () => {
  await assert.rejects(readPublishedNovelContent(executorWithRows([]), { novelId: 0 }), /owner/);
  await assert.rejects(readPublishedNovelContent(executorWithRows([]), { novelId: 1, previewRatio: 0 }), /preview ratio/);
  await assert.rejects(
    readPublishedNovelContent(executorWithRows([{ ...publishedRow, active_content_version: "stale" }]), { novelId: 1 }),
    ContentNotPublishedError,
  );
});
