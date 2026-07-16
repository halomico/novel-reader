import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeContentIndexDb } from "./content-index-db";

test("upgrades a populated legacy index stats table without timestamp defaults", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE content_search_term_stats (
      term TEXT PRIMARY KEY,
      segment_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'indexed'
    );
    INSERT INTO content_search_term_stats (term, segment_count, status) VALUES ('legacy', 2, 'indexed');
  `);

  initializeContentIndexDb(db);
  const row = db
    .prepare("SELECT created_at AS createdAt, updated_at AS updatedAt FROM content_search_term_stats WHERE term = 'legacy'")
    .get() as { createdAt: string | null; updatedAt: string | null };
  assert.ok(row.createdAt);
  assert.ok(row.updatedAt);
  db.close();
});

test("repairs legacy rows whose last use overwrote the index build timestamp", () => {
  const db = new DatabaseSync(":memory:");
  initializeContentIndexDb(db);
  db.prepare(
    `INSERT INTO content_search_term_stats
      (term, segment_count, novel_count, status, source, hit_count, last_used_at, created_at, updated_at)
     VALUES ('legacy-used', 1, 1, 'indexed', 'auto', 2, '2026-07-16 12:00:00', '2026-07-15 09:00:00', '2026-07-16 12:00:00')`,
  ).run();

  initializeContentIndexDb(db);

  const row = db
    .prepare("SELECT created_at AS createdAt, updated_at AS updatedAt FROM content_search_term_stats WHERE term = 'legacy-used'")
    .get() as { createdAt: string; updatedAt: string };
  assert.equal(row.updatedAt, row.createdAt);
  db.close();
});
