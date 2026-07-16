import "dotenv/config";

import { getContentSearchDb } from "../src/lib/content-search-db";
import { buildContentSearchIndex } from "../src/lib/content-search-index";
import { getDb } from "../src/lib/db";

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = "B";
  for (const current of units) {
    size /= 1024;
    unit = current;
    if (size < 1024) {
      break;
    }
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: npm run index:search -- [options]

Options:
  --force        discard existing rows before rebuilding
  --no-optimize  skip the final FTS optimize step
  -h, --help     show this help`);
    return;
  }

  const force = process.argv.includes("--force");
  const optimize = !process.argv.includes("--no-optimize");
  const startedAt = Date.now();
  let lastPrint = 0;

  const result = await buildContentSearchIndex(
    getDb(),
    getContentSearchDb(),
    (progress) => {
      const now = Date.now();
      if (now - lastPrint < 1000 && progress.processedBooks !== progress.totalBooks) {
        return;
      }
      lastPrint = now;
      const percent = progress.totalBooks ? Math.floor((progress.processedBooks / progress.totalBooks) * 100) : 100;
      console.log(
        `${percent}% (${progress.processedBooks}/${progress.totalBooks}) indexed=${progress.indexedBooks} reused=${progress.reusedBooks} failed=${progress.failedBooks}`,
      );
    },
    { force, optimize },
  );

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const ratio = result.sourceBytes ? result.databaseBytes / result.sourceBytes : 0;
  console.log(
    `finished in ${seconds}s; source=${formatBytes(result.sourceBytes)} index=${formatBytes(result.databaseBytes)} ratio=${ratio.toFixed(2)}x`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
