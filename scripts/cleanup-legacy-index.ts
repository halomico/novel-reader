import "dotenv/config";

import { getDb } from "../src/lib/db";
import { tableExists } from "../src/lib/content-index";

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function printStats(label: string) {
  const db = getDb();
  const pageSize = (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;
  const pageCount = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
  const freeCount = (db.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count;
  console.log(label);
  console.log(`database pages: ${formatBytes(pageSize * pageCount)}`);
  console.log(`free pages: ${formatBytes(pageSize * freeCount)}`);
}

function dropIfExists(tableName: string) {
  const db = getDb();
  if (tableExists(db, tableName)) {
    db.exec(`DROP TABLE ${tableName}`);
    console.log(`dropped ${tableName}`);
  }
}

function main() {
  const confirmed = hasArg("--confirm");
  const shouldVacuum = hasArg("--vacuum");
  printStats("before:");

  if (!confirmed) {
    console.log("dry run only. Add --confirm to drop legacy main-database index tables.");
    console.log("targets: content_search_terms, content_search_term_stats, novel_segments_fts, novel_segments");
    return;
  }

  dropIfExists("content_search_terms");
  dropIfExists("content_search_term_stats");
  dropIfExists("novel_segments_fts");
  dropIfExists("novel_segments");

  if (shouldVacuum) {
    getDb().exec("VACUUM");
    console.log("vacuum complete");
  }

  printStats("after:");
}

main();
