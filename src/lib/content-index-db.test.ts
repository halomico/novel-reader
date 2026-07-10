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
