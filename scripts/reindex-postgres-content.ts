import "dotenv/config";

import path from "node:path";
import type { QueryResultRow } from "pg";
import { closePostgresPools, database } from "@/core/db/postgres";
import {
  cleanupContentGenerations,
  ContentBuildSupersededError,
} from "@/domains/reading/postgres-content";
import {
  listPostgresContentReindexCandidates,
  reindexPostgresContentCandidate,
  type PostgresContentReindexCandidate,
  type PostgresContentOwnerKind,
} from "@/domains/reading/postgres-content-reindex";

type Options = {
  force: boolean;
  cleanup: boolean;
  concurrency: number;
  batchSize: number;
  novelId?: number;
  sourceSlug?: string;
};

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
  const known = /^(?:--force|--no-cleanup|--concurrency=\d+|--batch=\d+|--novel=\d+|--source=[a-zA-Z0-9-]+)$/u;
  const unknown = argv.find((value) => !known.test(value));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  const value = (prefix: string) => argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  return {
    force: argv.includes("--force"),
    cleanup: !argv.includes("--no-cleanup"),
    concurrency: integerOption("--concurrency", value("--concurrency="), 2, 8),
    batchSize: integerOption("--batch", value("--batch="), 25, 100),
    novelId: value("--novel=") === undefined ? undefined : integerOption("--novel", value("--novel="), 1, 2_147_483_647),
    sourceSlug: value("--source=")?.toLocaleLowerCase("en-US"),
  };
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run index:search -- [options]

Builds or incrementally refreshes PostgreSQL reader content and Chinese search blocks.

Options:
  --force           rebuild every selected document
  --no-cleanup      retain obsolete generations after publishing
  --concurrency=N   process 1-8 documents concurrently (default: 2)
  --batch=N         fetch 1-100 candidates per database round trip (default: 25)
  --novel=ID        process one novel and all of its chapters
  --source=SLUG     process one novel source
  -h, --help        show this help
`);
}

async function resolveSourceId(slug: string | undefined): Promise<number | undefined> {
  if (slug === undefined) return undefined;
  const result = await database("jobs").query<QueryResultRow & { id: number }>({
    text: "SELECT id FROM novel_sources WHERE lower(slug) = $1 LIMIT 1",
    values: [slug],
  });
  const id = result.rows[0]?.id;
  if (!Number.isSafeInteger(id) || Number(id) < 1) throw new Error(`Novel source does not exist: ${slug}`);
  return Number(id);
}

async function processBatch(
  candidates: readonly PostgresContentReindexCandidate[],
  concurrency: number,
  libraryRoot: string,
  signal: AbortSignal,
): Promise<{ indexed: number; bytes: number; superseded: number; errors: string[] }> {
  let cursor = 0;
  let indexed = 0;
  let bytes = 0;
  let superseded = 0;
  const errors: string[] = [];
  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const candidate = candidates[index];
      if (!candidate) return;
      try {
        const result = await reindexPostgresContentCandidate(candidate, libraryRoot, signal);
        indexed += 1;
        bytes += result.bytes;
      } catch (error) {
        if (error instanceof ContentBuildSupersededError) {
          superseded += 1;
        } else {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${candidate.chapterId === null ? "novel" : "chapter"} ${candidate.ownerId} (${candidate.title}): ${message}`);
        }
      }
    }
  });
  await Promise.all(workers);
  return { indexed, bytes, superseded, errors };
}

async function processKind(
  kind: PostgresContentOwnerKind,
  options: Options,
  sourceId: number | undefined,
  libraryRoot: string,
  signal: AbortSignal,
): Promise<{ selected: number; indexed: number; bytes: number; superseded: number; errors: string[] }> {
  let cursor = 0;
  const totals = { selected: 0, indexed: 0, bytes: 0, superseded: 0, errors: [] as string[] };
  while (true) {
    signal.throwIfAborted();
    const candidates = await listPostgresContentReindexCandidates(database("jobs"), kind, {
      cursor,
      limit: options.batchSize,
      novelId: options.novelId,
      sourceId,
      force: options.force,
    });
    if (!candidates.length) break;
    totals.selected += candidates.length;
    const batch = await processBatch(candidates, options.concurrency, libraryRoot, signal);
    totals.indexed += batch.indexed;
    totals.bytes += batch.bytes;
    totals.superseded += batch.superseded;
    totals.errors.push(...batch.errors);
    cursor = candidates.at(-1)!.ownerId;
    process.stdout.write(`${JSON.stringify({
      event: "postgres.content.reindex.progress",
      kind,
      selected: totals.selected,
      indexed: totals.indexed,
      bytes: totals.bytes,
      superseded: totals.superseded,
      failed: totals.errors.length,
    })}\n`);
  }
  return totals;
}

async function cleanupObsoleteContent(signal: AbortSignal): Promise<{ blocks: number; generations: number }> {
  let blocks = 0;
  let generations = 0;
  while (true) {
    signal.throwIfAborted();
    const deleted = await cleanupContentGenerations(database("jobs"), 10_000);
    blocks += deleted.blocksDeleted;
    generations += deleted.generationsDeleted;
    if (deleted.blocksDeleted === 0 && deleted.generationsDeleted === 0) return { blocks, generations };
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    printHelp();
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("PostgreSQL content reindex interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const startedAt = Date.now();
    const libraryRoot = path.resolve(process.env.NOVEL_LIBRARY_DIR?.trim() || "./library/books");
    const sourceId = await resolveSourceId(options.sourceSlug);
    const novel = await processKind("novel", options, sourceId, libraryRoot, controller.signal);
    const chapter = await processKind("chapter", options, sourceId, libraryRoot, controller.signal);
    const cleanup = options.cleanup
      ? await cleanupObsoleteContent(controller.signal)
      : { blocks: 0, generations: 0 };
    const summary = {
      event: "postgres.content.reindex.complete",
      selected: novel.selected + chapter.selected,
      indexed: novel.indexed + chapter.indexed,
      bytes: novel.bytes + chapter.bytes,
      superseded: novel.superseded + chapter.superseded,
      failed: novel.errors.length + chapter.errors.length,
      obsoleteBlocksDeleted: cleanup.blocks,
      obsoleteGenerationsDeleted: cleanup.generations,
      elapsedMs: Date.now() - startedAt,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    const errors = [...novel.errors, ...chapter.errors];
    for (const error of errors.slice(0, 20)) process.stderr.write(`${error}\n`);
    if (errors.length > 20) process.stderr.write(`${errors.length - 20} additional error(s) omitted\n`);
    if (summary.failed || summary.superseded) {
      throw new Error("PostgreSQL content reindex did not converge; correct source errors or rerun after concurrent changes stop");
    }
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
