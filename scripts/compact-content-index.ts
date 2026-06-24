import "dotenv/config";

import { getContentIndexStorageSummary, pruneColdAutoIndexes } from "../src/lib/content-index";
import { getContentIndexDb } from "../src/lib/content-index-db";

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

function printSummary(label: string) {
  const summary = getContentIndexStorageSummary();
  console.log(label);
  console.log(`path: ${summary.databasePath}`);
  console.log(`size: ${formatBytes(summary.databaseBytes)}`);
  console.log(`soft limit: ${formatBytes(summary.softLimitBytes)}`);
  console.log(`hard limit: ${formatBytes(summary.hardLimitBytes)}`);
  console.log(`terms: ${summary.termCount} (auto ${summary.autoTermCount}, manual ${summary.manualTermCount})`);
}

function main() {
  const db = getContentIndexDb();
  printSummary("before:");

  if (hasArg("--prune")) {
    const deleted = pruneColdAutoIndexes(db);
    console.log(`pruned ${deleted.length} auto indexes`);
  }

  if (hasArg("--vacuum")) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.exec("VACUUM;");
    console.log("vacuum complete");
  }

  printSummary("after:");
}

main();
