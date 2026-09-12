import "dotenv/config";

import { closePostgresPools, database, withTransaction } from "@/core/db/postgres";
import {
  deleteOrphanedSearchDocuments,
  listStaleSearchDocuments,
  readDocumentOriginalText,
  rebuildContentSearchDocument,
  writeContentSearchDocument,
  type StaleSearchDocument,
} from "@/domains/reading/postgres-search-index";

/*
 * Brings novel_search_documents up to date with the published library.
 *
 * Every row is derived from the block text already stored in PostgreSQL, so this never
 * reads the library files and never republishes anything: a document's reader content,
 * offsets and generation are untouched. It is safe to interrupt and to rerun; each run
 * picks up only documents whose search row is missing or belongs to an older generation.
 *
 * Normalization runs at about 2 million characters per second per worker, so a 10 GB
 * library takes on the order of half an hour at the default concurrency.
 */

type Options = { concurrency: number; batchSize: number };

function integerOption(name: string, raw: string | undefined, fallback: number, maximum: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function parseOptions(argv: readonly string[]): Options | null {
  if (argv.includes("--help") || argv.includes("-h")) return null;
  const known = /^(?:--concurrency=\d+|--batch=\d+)$/u;
  const unknown = argv.find((value) => !known.test(value));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  const value = (prefix: string) => argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  return {
    concurrency: integerOption("--concurrency", value("--concurrency="), 4, 16),
    batchSize: integerOption("--batch", value("--batch="), 200, 1_000),
  };
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run index:search-text -- [options]

Rebuilds the document-level full-text search rows from stored content, without reading
library files or republishing content.

Options:
  --concurrency=N   normalize 1-16 documents concurrently (default: 4)
  --batch=N         fetch 1-1000 stale documents per database round trip (default: 200)
  -h, --help        show this help
`);
}

type Outcome = "written" | "superseded";

async function rebuild(document: StaleSearchDocument): Promise<Outcome> {
  const source = await readDocumentOriginalText(database("jobs"), document.documentId, document.generation);
  // A generation cleaned up between listing and reading has no blocks left to describe.
  if (source.blockCount !== document.blockCount) return "superseded";
  const search = await rebuildContentSearchDocument(source.text);
  if (search.blockStarts.length !== document.blockCount) {
    throw new Error(`re-split into ${search.blockStarts.length} blocks, stored ${document.blockCount}`);
  }
  return withTransaction(async (tx) => {
    // Publishing locks the document row FOR UPDATE, so holding it FOR SHARE means the row
    // written here cannot land on top of a generation published while this one was built.
    const current = await tx.query<{ active_generation: number }>({
      text: "SELECT active_generation FROM novel_documents WHERE id = $1 FOR SHARE",
      values: [document.documentId],
    });
    if (current.rows[0]?.active_generation !== document.generation) return "superseded";
    await writeContentSearchDocument(tx, document.documentId, document.generation, search);
    return "written";
  }, { role: "jobs" });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    printHelp();
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Search text rebuild interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const startedAt = Date.now();
  const totals = { written: 0, superseded: 0, failed: 0, orphansDeleted: 0 };
  const errors: string[] = [];
  try {
    let after: string | undefined;
    while (true) {
      controller.signal.throwIfAborted();
      const batch = await listStaleSearchDocuments(database("jobs"), { after, limit: options.batchSize });
      if (!batch.length) break;
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(options.concurrency, batch.length) }, async () => {
        while (cursor < batch.length) {
          controller.signal.throwIfAborted();
          const document = batch[cursor++];
          try {
            totals[await rebuild(document)] += 1;
          } catch (error) {
            totals.failed += 1;
            errors.push(`document ${document.documentId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }));
      after = batch.at(-1)!.documentId;
      process.stdout.write(`${JSON.stringify({ event: "postgres.search_text.rebuild.progress", after, ...totals })}\n`);
    }
    while (true) {
      controller.signal.throwIfAborted();
      const deleted = await deleteOrphanedSearchDocuments(database("jobs"), 10_000);
      totals.orphansDeleted += deleted;
      if (!deleted) break;
    }
    await database("jobs").query({ text: "ANALYZE novel_search_documents" });
    process.stdout.write(`${JSON.stringify({
      event: "postgres.search_text.rebuild.complete", ...totals, elapsedMs: Date.now() - startedAt,
    })}\n`);
    for (const error of errors.slice(0, 20)) process.stderr.write(`${error}\n`);
    if (errors.length > 20) process.stderr.write(`${errors.length - 20} additional error(s) omitted\n`);
    if (totals.failed) throw new Error("Search text rebuild did not converge; see the errors above");
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPools());
