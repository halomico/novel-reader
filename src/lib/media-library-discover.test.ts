import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("library sync does not import new files when discover is off", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-discover-"));
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    MEDIA_DIR: process.env.MEDIA_DIR,
    MEDIA_STORAGE_MODE: process.env.MEDIA_STORAGE_MODE,
    ADMIN_SETTINGS_PATH: process.env.ADMIN_SETTINGS_PATH,
    MEDIA_LIBRARY_DISCOVER: process.env.MEDIA_LIBRARY_DISCOVER,
  };
  process.env.DATABASE_PATH = path.join(tempDir, "novels.db");
  process.env.MEDIA_DIR = path.join(tempDir, "media");
  process.env.MEDIA_STORAGE_MODE = "local";
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "settings.json");
  process.env.MEDIA_LIBRARY_DISCOVER = "off";
  let closeDatabase: (() => void) | null = null;

  try {
    const media = await import("./media");
    const { getDb } = await import("./db");
    const db = getDb();
    closeDatabase = () => db.close();
    const audioDir = path.join(process.env.MEDIA_DIR!, "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, "keep.mp3"), "ID3-keep");
    fs.writeFileSync(path.join(audioDir, "extra.mp3"), "ID3-extra");
    db.prepare(
      `INSERT INTO media_assets (kind, title, file_name, stored_name, mime_type, size_bytes)
       VALUES ('audio', '保留', 'keep.mp3', 'audio/keep.mp3', 'audio/mpeg', 8)`,
    ).run();

    assert.deepEqual(await media.syncMediaLibrary({ force: true }), { added: 0, updated: 0, removed: 0 });
    const rows = db.prepare("SELECT stored_name FROM media_assets WHERE kind = 'audio' ORDER BY stored_name").all() as Array<{
      stored_name: string;
    }>;
    assert.deepEqual(rows.map((row) => row.stored_name), ["audio/keep.mp3"]);
    assert.equal(media.listMediaFolders("audio").length, 0);
  } finally {
    closeDatabase?.();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
