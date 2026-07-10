import "dotenv/config";

import { DatabaseSync } from "node:sqlite";
import { getContentIndexDatabasePath, getContentIndexTerms } from "../src/lib/config";
import { initializeContentIndexDb } from "../src/lib/content-index-db";
import { normalizeContentIndexTerms, tableExists } from "../src/lib/content-index";
import { getDb } from "../src/lib/db";

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function prepareTargetDb() {
  const db = new DatabaseSync(getContentIndexDatabasePath());
  initializeContentIndexDb(db);
  db.close();
}

function attachTargetDb(db: DatabaseSync) {
  const rows = db.prepare("PRAGMA database_list").all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === "content_index")) {
    return;
  }
  db.prepare("ATTACH DATABASE ? AS content_index").run(getContentIndexDatabasePath());
}

function insertManualTerms(db: DatabaseSync, terms: string[]) {
  db.exec("DROP TABLE IF EXISTS temp.migration_manual_terms");
  db.exec("CREATE TEMP TABLE migration_manual_terms (term TEXT PRIMARY KEY)");
  const insert = db.prepare("INSERT OR IGNORE INTO migration_manual_terms (term) VALUES (?)");
  for (const term of terms) {
    insert.run(term);
  }
}

function main() {
  prepareTargetDb();
  const db = getDb();
  attachTargetDb(db);

  const hasLegacyTerms = tableExists(db, "content_search_terms");
  const hasLegacyStats = tableExists(db, "content_search_term_stats");
  if (!hasLegacyTerms && !hasLegacyStats) {
    console.log("main database has no legacy content index tables. Nothing to migrate.");
    return;
  }

  const manualTerms = normalizeContentIndexTerms(getContentIndexTerms());
  insertManualTerms(db, manualTerms);

  db.exec("BEGIN");
  try {
    if (hasLegacyTerms) {
      db.exec(`
        INSERT OR IGNORE INTO content_index.content_search_terms (term, novel_id)
        SELECT term, novel_id
        FROM main.content_search_terms
      `);
    }

    if (hasLegacyStats) {
      db.exec(`
        INSERT INTO content_index.content_search_term_stats (term, segment_count, novel_count, status, source, created_at, updated_at)
        SELECT
          s.term,
          s.segment_count,
          COALESCE(c.novel_count, 0) AS novel_count,
          s.status,
          CASE WHEN m.term IS NULL THEN 'auto' ELSE 'manual' END AS source,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM main.content_search_term_stats s
        LEFT JOIN (
          SELECT term, COUNT(*) AS novel_count
          FROM content_index.content_search_terms
          GROUP BY term
        ) c ON c.term = s.term
        LEFT JOIN temp.migration_manual_terms m ON m.term = s.term
        ON CONFLICT(term) DO UPDATE SET
          segment_count = excluded.segment_count,
          novel_count = excluded.novel_count,
          status = excluded.status,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
      `);
    } else if (hasLegacyTerms) {
      db.exec(`
        INSERT INTO content_index.content_search_term_stats (term, segment_count, novel_count, status, source, created_at, updated_at)
        SELECT
          t.term,
          COUNT(*) AS segment_count,
          COUNT(*) AS novel_count,
          'indexed' AS status,
          CASE WHEN m.term IS NULL THEN 'auto' ELSE 'manual' END AS source,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM content_index.content_search_terms t
        LEFT JOIN temp.migration_manual_terms m ON m.term = t.term
        GROUP BY t.term
        ON CONFLICT(term) DO UPDATE SET
          segment_count = excluded.segment_count,
          novel_count = excluded.novel_count,
          status = excluded.status,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
      `);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const countRow = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM content_index.content_search_term_stats) AS term_count,
        (SELECT COUNT(*) FROM content_index.content_search_terms) AS row_count
    `,
    )
    .get() as { term_count: number; row_count: number };

  db.exec("PRAGMA content_index.wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM content_index");
  db.exec(`DETACH DATABASE ${quoteIdent("content_index")}`);
  console.log(`migrated ${formatNumber(countRow.term_count)} terms and ${formatNumber(countRow.row_count)} rows to ${getContentIndexDatabasePath()}`);
  console.log("After testing, run npm run cleanup:legacy-index -- --confirm --vacuum to remove old main-database index tables.");
}

main();
