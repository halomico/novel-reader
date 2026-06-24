import "dotenv/config";

import { buildContentIndexTerms, normalizeContentIndexTerms } from "../src/lib/content-index";
import { getManualIndexMaxSegments, isManualIndexMaxSegmentsEnabled } from "../src/lib/config";
import { getDb } from "../src/lib/db";

function readTermsFromArgs(): string[] {
  const cliTerms = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .flatMap((arg) => arg.split(/[\n,]/));
  return normalizeContentIndexTerms(cliTerms.length ? cliTerms : undefined);
}

async function main() {
  const terms = readTermsFromArgs();
  if (!terms.length) {
    console.log("CONTENT_INDEX_TERMS is empty. Pass terms as arguments or set CONTENT_INDEX_TERMS in .env.");
    return;
  }

  const maxSegments = isManualIndexMaxSegmentsEnabled() ? getManualIndexMaxSegments() : null;
  const startedAt = Date.now();
  let lastPrint = 0;
  const statuses = await buildContentIndexTerms(
    getDb(),
    terms,
    (progress) => {
      const now = Date.now();
      if (now - lastPrint < 1000 && progress.scannedBooks !== progress.totalBooks) {
        return;
      }
      lastPrint = now;
      const total = progress.totalBooks || 0;
      console.log(
        `scanned ${progress.scannedBooks}/${total} books, ${progress.segmentCount} matched segments, ${progress.totalTerms || terms.length} terms`,
      );
    },
    { source: "manual", maxSegments },
  );

  console.log(`finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  for (const item of statuses) {
    console.log(`- ${item.term}: ${item.status}, ${item.segmentCount} segments`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
