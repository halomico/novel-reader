import "dotenv/config";

import { buildContentSearchSourceIndex } from "../src/lib/content-search-sources";
import { getDb } from "../src/lib/db";
import { getNovelSourceBySlug, listNovelSources } from "../src/lib/novel-library";
import { isNovelSourceFullTextSearchEnabled } from "../src/lib/novel-search-policy";

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
  --source=SLUG  build one full-text-enabled library
  -h, --help     show this help`);
    return;
  }

  const force = process.argv.includes("--force");
  const optimize = !process.argv.includes("--no-optimize");
  const requestedSlug = process.argv.find((value) => value.startsWith("--source="))?.slice("--source=".length).trim();
  const requestedSource = requestedSlug ? getNovelSourceBySlug(requestedSlug) : null;
  if (requestedSlug && !requestedSource) throw new Error("小说书库不存在");
  if (requestedSource && !isNovelSourceFullTextSearchEnabled(requestedSource.slug)) {
    throw new Error("轻量书库不创建全文索引");
  }
  const sources = requestedSource
    ? [requestedSource]
    : listNovelSources({ includeEmpty: true }).filter((source) => isNovelSourceFullTextSearchEnabled(source.slug));
  const startedAt = Date.now();
  let totalSourceBytes = 0;
  let totalDatabaseBytes = 0;
  for (const source of sources) {
    let lastPrint = 0;
    console.log(`[${source.name}] source-${source.id}.db`);
    const result = await buildContentSearchSourceIndex(
      getDb(),
      source.id,
      (progress) => {
        const now = Date.now();
        if (now - lastPrint < 1000 && progress.processedBooks !== progress.totalBooks) return;
        lastPrint = now;
        const percent = progress.totalBooks ? Math.floor((progress.processedBooks / progress.totalBooks) * 100) : 100;
        console.log(
          `${percent}% (${progress.processedBooks}/${progress.totalBooks}) indexed=${progress.indexedBooks} reused=${progress.reusedBooks} failed=${progress.failedBooks}`,
        );
      },
      { force, optimize },
    );
    totalSourceBytes += result.sourceBytes;
    totalDatabaseBytes += result.databaseBytes;
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const ratio = totalSourceBytes ? totalDatabaseBytes / totalSourceBytes : 0;
  console.log(
    `finished in ${seconds}s; source=${formatBytes(totalSourceBytes)} index=${formatBytes(totalDatabaseBytes)} ratio=${ratio.toFixed(2)}x`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
