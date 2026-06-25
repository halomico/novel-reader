import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { findIndexedContentCandidateNovelIds, normalizeContentIndexTerms, refreshContentIndexTermStats, saveContentIndexTerm } from "./content-index";

function createMemoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE content_search_terms (
      term TEXT NOT NULL,
      novel_id INTEGER NOT NULL,
      PRIMARY KEY(term, novel_id)
    ) WITHOUT ROWID;

    CREATE TABLE content_search_term_stats (
      term TEXT PRIMARY KEY,
      segment_count INTEGER NOT NULL DEFAULT 0,
      novel_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'indexed',
      source TEXT NOT NULL DEFAULT 'auto',
      hit_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

test("normalizes and deduplicates manual content index terms", () => {
  assert.deepEqual(normalizeContentIndexTerms(["a-b", "ab", " a b ", ""]), ["ab"]);
});

test("keeps manual content index rows above the frontend segment threshold", () => {
  const previous = process.env.CONTENT_INDEX_MAX_SEGMENTS;
  process.env.CONTENT_INDEX_MAX_SEGMENTS = "2";
  const db = createMemoryDb();
  const insert = db.prepare("INSERT INTO content_search_terms (term, novel_id) VALUES (?, ?)");
  insert.run("rare", 1);
  insert.run("rare", 2);
  insert.run("common", 1);
  insert.run("common", 2);
  insert.run("common", 3);

  try {
    const stats = refreshContentIndexTermStats(db, ["rare", "common"]);
    assert.deepEqual(stats, [
      { term: "rare", segmentCount: 2, status: "indexed", source: "manual" },
      { term: "common", segmentCount: 3, status: "indexed", source: "manual" },
    ]);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_search_terms WHERE term = 'common'").get() as { count: number }).count, 3);
  } finally {
    if (previous === undefined) {
      delete process.env.CONTENT_INDEX_MAX_SEGMENTS;
    } else {
      process.env.CONTENT_INDEX_MAX_SEGMENTS = previous;
    }
  }
});

test("saves indexed terms and skips oversized terms", () => {
  const previous = process.env.CONTENT_INDEX_MAX_SEGMENTS;
  process.env.CONTENT_INDEX_MAX_SEGMENTS = "2";
  const db = createMemoryDb();

  try {
    const indexed = saveContentIndexTerm(db, "a-b", [1, 2, 2], 2, { enforceBudget: false });
    assert.deepEqual(indexed, { term: "ab", segmentCount: 2, status: "indexed", source: "auto" });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_search_terms WHERE term = 'ab'").get() as { count: number }).count, 2);

    const skipped = saveContentIndexTerm(db, "common", [1, 2, 3], 3, { maxSegments: 2, enforceBudget: false });
    assert.deepEqual(skipped, { term: "common", segmentCount: 3, status: "skipped", source: "auto" });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_search_terms WHERE term = 'common'").get() as { count: number }).count, 0);

    const manual = saveContentIndexTerm(db, "manual", [1, 2, 3], 3, { maxSegments: null, source: "manual", enforceBudget: false });
    assert.deepEqual(manual, { term: "manual", segmentCount: 3, status: "indexed", source: "manual" });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_search_terms WHERE term = 'manual'").get() as { count: number }).count, 3);
  } finally {
    if (previous === undefined) {
      delete process.env.CONTENT_INDEX_MAX_SEGMENTS;
    } else {
      process.env.CONTENT_INDEX_MAX_SEGMENTS = previous;
    }
  }
});

test("intersects indexed candidate novels for required content terms", () => {
  const db = createMemoryDb();
  saveContentIndexTerm(db, "苹果", [1, 2, 3], 3, { enforceBudget: false });
  saveContentIndexTerm(db, "香蕉", [2, 3, 4], 3, { enforceBudget: false });

  const plan = findIndexedContentCandidateNovelIds(db, ["苹果", "小香蕉"]);
  assert.deepEqual(plan, {
    terms: ["苹果", "香蕉"],
    requestedTerms: ["苹果", "小香蕉"],
    novelIds: [2, 3],
  });
});
