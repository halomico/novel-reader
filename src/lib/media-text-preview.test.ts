import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { getMediaAsset } from "./media";
import { getMediaTextPreview, isMediaTextPreviewSupported } from "./media-text-preview";

function withTempMedia(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousMediaDir = process.env.MEDIA_DIR;
  const previousStorageMode = process.env.MEDIA_STORAGE_MODE;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-text-preview-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.MEDIA_DIR = path.join(root, "media");
  process.env.MEDIA_STORAGE_MODE = "local";
  fs.mkdirSync(path.join(root, "media", "file"), { recursive: true });
  const state = globalThis as typeof globalThis & {
    novelReaderDb?: DatabaseSync;
    mediaTextPreviewCache?: Map<string, unknown>;
  };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  delete state.mediaTextPreviewCache;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    delete state.mediaTextPreviewCache;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousMediaDir === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = previousMediaDir;
    if (previousStorageMode === undefined) delete process.env.MEDIA_STORAGE_MODE;
    else process.env.MEDIA_STORAGE_MODE = previousStorageMode;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("text and markdown previews read local content once without exposing unsupported files", async (t) => {
  const root = withTempMedia(t);
  const content = "# 标题\r\n\r\n正文";
  fs.writeFileSync(path.join(root, "media", "file", "note.md"), content, "utf8");
  const db = getDb();
  const mediaId = Number(db
    .prepare(
      `INSERT INTO media_assets (
         kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms
       )
       VALUES ('file', '说明', 'note.md', 'file/note.md', 'text/markdown', ?, 1)`,
    )
    .run(Buffer.byteLength(content)).lastInsertRowid);
  const asset = getMediaAsset(mediaId)!;
  assert.equal(isMediaTextPreviewSupported(asset), true);
  assert.deepEqual(await getMediaTextPreview(asset), {
    format: "markdown",
    content: "# 标题\n\n正文",
    truncated: false,
  });

  const unsupportedId = Number(db
    .prepare(
      `INSERT INTO media_assets (
         kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms
       )
       VALUES ('file', '压缩包', 'archive.zip', 'file/archive.zip', 'application/zip', 1, 1)`,
    )
    .run().lastInsertRowid);
  assert.equal(isMediaTextPreviewSupported(getMediaAsset(unsupportedId)!), false);
});
