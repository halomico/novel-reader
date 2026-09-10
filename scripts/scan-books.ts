import "dotenv/config";

import { closePostgresPools } from "../src/core/db/postgres";
import { initializePostgresApplication } from "../src/core/db/postgres-bootstrap";
import { scanPostgresNovelLibrary } from "../src/domains/catalog/postgres-library-scan";

async function main(): Promise<void> {
  await initializePostgresApplication();
  const result = await scanPostgresNovelLibrary({ verifyHashes: process.argv.includes("--verify") });
  console.log(
    `扫描完成：${result.books} 本，${result.files} 个文件，更新 ${result.insertedOrUpdated} 本，`
      + `发布正文 ${result.publishedDocuments} 份，跳过 ${result.skipped} 项，耗时 ${(result.elapsedMs / 1_000).toFixed(1)}s`,
  );
  console.log(JSON.stringify({ event: "catalog.scan.completed", ...result }));
  if (result.republishedUnchangedDocuments > 0) {
    console.warn(JSON.stringify({
      event: "catalog.scan.unchanged-content-republished",
      documents: result.republishedUnchangedDocuments,
      message: "Unchanged source files required publication; check version or index state if this repeats.",
    }));
  }
  for (const record of result.records) console.log(`- ${record}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPools());
