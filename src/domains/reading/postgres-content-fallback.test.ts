import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { CONTENT_BLOCK_CODE_POINTS } from "./content-text";
import { ContentSourceUnavailableError, readNovelContentFromSource } from "./postgres-content-fallback";

function executorWithRows(rows: QueryResultRow[], captured: SqlQuery[] = []): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
}

async function library(text: string): Promise<{ root: string; digest: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-reader-fallback-"));
  const bytes = Buffer.from(text, "utf8");
  await fs.writeFile(path.join(root, "book.txt"), bytes);
  return {
    root,
    digest: createHash("sha256").update(bytes).digest("hex"),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

test("an unindexed book is served from its catalogued source file, blocked exactly as the indexer would", async () => {
  // Two full blocks plus a remainder, so the boundary arithmetic is actually exercised.
  const body = "甲".repeat(CONTENT_BLOCK_CODE_POINTS * 2 + 17);
  const { root, digest, cleanup } = await library(body);
  try {
    const captured: SqlQuery[] = [];
    const content = await readNovelContentFromSource(
      executorWithRows([{ relative_path: "book.txt", content_hash: digest }], captured),
      { novelId: 7, chapterId: 9 },
      root,
    );
    assert.deepEqual(captured[0].values, [7, 9]);
    assert.equal(content.generation, 0, "source reads never claim a generation");
    assert.equal(content.contentVersion, `source:${digest}`);
    assert.equal(content.totalUtf16Length, body.length);
    assert.deepEqual(content.blocks.map((block) => [block.charStart, block.charEnd]), [
      [0, CONTENT_BLOCK_CODE_POINTS],
      [CONTENT_BLOCK_CODE_POINTS, CONTENT_BLOCK_CODE_POINTS * 2],
      [CONTENT_BLOCK_CODE_POINTS * 2, body.length],
    ]);
    assert.equal(content.blocks.map((block) => block.originalText).join(""), body);
  } finally {
    await cleanup();
  }
});

test("a locked book's source read stops at the same preview cutoff as the published path", async () => {
  const body = "乙".repeat(100);
  const { root, digest, cleanup } = await library(body);
  try {
    const content = await readNovelContentFromSource(
      executorWithRows([{ relative_path: "book.txt", content_hash: digest }]),
      { novelId: 7, previewRatio: 0.3 },
      root,
    );
    assert.equal(content.totalUtf16Length, 30);
    assert.equal(content.blocks.length, 1);
    assert.equal(content.blocks[0].originalText, "乙".repeat(30));
  } finally {
    await cleanup();
  }
});

test("source reads fail closed rather than serve text whose offsets no longer match the catalog", async () => {
  const { root, digest, cleanup } = await library("丙丁戊");
  try {
    // A file edited after the catalog scan would shift every stored progress anchor.
    await assert.rejects(readNovelContentFromSource(
      executorWithRows([{ relative_path: "book.txt", content_hash: "0".repeat(64) }]),
      { novelId: 7 },
      root,
    ), /changed/);

    await assert.rejects(readNovelContentFromSource(
      executorWithRows([{ relative_path: "", content_hash: digest }]),
      { novelId: 7 },
      root,
    ), ContentSourceUnavailableError);

    // A chapter that does not belong to the novel yields no row at all.
    await assert.rejects(readNovelContentFromSource(
      executorWithRows([]),
      { novelId: 7, chapterId: 4 },
      root,
    ), ContentSourceUnavailableError);

    await assert.rejects(readNovelContentFromSource(
      executorWithRows([{ relative_path: "book.txt", content_hash: digest }]),
      { novelId: 0 },
      root,
    ), /owner/);
  } finally {
    await cleanup();
  }
});
