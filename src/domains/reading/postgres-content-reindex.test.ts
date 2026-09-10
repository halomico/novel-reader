import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CONTENT_NORMALIZATION_VERSION } from "./content-text";
import {
  buildPostgresContentCandidateQuery,
  countPostgresContentReindexCandidates,
  readVerifiedPostgresContentSource,
} from "./postgres-content-reindex";

test("PostgreSQL content candidates are incremental, bounded, and owner-specific", () => {
  const novels = buildPostgresContentCandidateQuery("novel", { cursor: 7, sourceId: 3, limit: 40 });
  assert.match(novels.text, /n\.id > \$1/);
  assert.match(novels.text, /d\.chapter_id IS NULL/);
  assert.match(novels.text, /n\.storage_mode = 'single'/);
  assert.match(novels.text, /g\.source_content_version IS DISTINCT FROM n\.content_hash/);
  assert.match(novels.text, /normalization_version/);
  assert.deepEqual(novels.values, [7, 3, CONTENT_NORMALIZATION_VERSION, 40]);

  const chapters = buildPostgresContentCandidateQuery("chapter", { novelId: 9, force: true });
  assert.match(chapters.text, /JOIN novel_chapters c ON c\.novel_id = n\.id/);
  assert.match(chapters.text, /d\.chapter_id = c\.id/);
  assert.match(chapters.text, /n\.storage_mode = 'chapters'/);
  assert.doesNotMatch(chapters.text, /normalization_version/);
  assert.deepEqual(chapters.values, [0, 9, 25]);
});

test("PostgreSQL content candidate counts reuse the exact incremental predicate", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const count = await countPostgresContentReindexCandidates({
    async query(query) {
      calls.push({ text: query.text, values: query.values || [] });
      return { rows: [{ count: "17" }] } as never;
    },
  }, "chapter", { sourceId: 4 });
  assert.equal(count, 17);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /^SELECT COUNT\(\*\) AS count FROM novels n/u);
  assert.match(calls[0].text, /g\.source_content_version IS DISTINCT FROM c\.content_hash/u);
  assert.doesNotMatch(calls[0].text, /ORDER BY|LIMIT/u);
  assert.deepEqual(calls[0].values, [0, 4, CONTENT_NORMALIZATION_VERSION]);
});

test("PostgreSQL content source verification rejects traversal and stale files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-reader-content-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "novel-reader-outside-"));
  try {
    const bytes = Buffer.from("繁體中文正文\r\n第二行", "utf8");
    await fs.writeFile(path.join(root, "book.txt"), bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const source = await readVerifiedPostgresContentSource(root, {
      relativePath: "book.txt",
      sourceContentVersion: digest,
    });
    assert.equal(source.text, "繁體中文正文\n第二行");
    assert.equal(source.bytes, bytes.length);
    await assert.rejects(readVerifiedPostgresContentSource(root, {
      relativePath: "book.txt",
      sourceContentVersion: "0".repeat(64),
    }), /changed/);
    await assert.rejects(readVerifiedPostgresContentSource(root, {
      relativePath: path.relative(root, path.join(outside, "escape.txt")),
      sourceContentVersion: digest,
    }), /leaves/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
