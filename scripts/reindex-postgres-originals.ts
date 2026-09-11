import "dotenv/config";

import type { QueryResultRow } from "pg";
import { closePostgresPools, database, withTransaction } from "@/core/db/postgres";
import { CONTENT_NORMALIZATION_VERSION } from "@/domains/reading/content-text";
import { createPostgresOriginalSearchFields } from "@/domains/originals/postgres-original-index";

const BATCH_SIZE = 200;
const MAX_CONFLICT_PASSES = 4;

type ArticleRow = QueryResultRow & {
  id: string;
  title: string;
  body_markdown: string;
  updated_at: string;
};

async function reindexPass(): Promise<{ selected: number; updated: number }> {
  const reader = database("jobs");
  let cursor = "0";
  let selected = 0;
  let updated = 0;
  while (true) {
    const result = await reader.query<ArticleRow>({
      text: `SELECT id::text, title, body_markdown, updated_at::text
        FROM original_articles
        WHERE normalization_version <> $1 AND id > $2::bigint
        ORDER BY id
        LIMIT $3`,
      values: [CONTENT_NORMALIZATION_VERSION, cursor, BATCH_SIZE],
    });
    if (!result.rows.length) break;
    const prepared = await Promise.all(result.rows.map(async (row) => ({
      row,
      // Only the public body is searchable; the paid body is never read here.
      fields: await createPostgresOriginalSearchFields(row.title, row.body_markdown),
    })));
    await withTransaction(async (transaction) => {
      for (const { row, fields } of prepared) {
        const write = await transaction.query({
          text: `UPDATE original_articles
            SET title_search_original = $1, title_search_hans = $2,
                content_search_original = $3, content_search_hans = $4,
                normalization_version = $5
            WHERE id = $6::bigint AND updated_at = $7::timestamptz
              AND normalization_version <> $5`,
          values: [
            fields.titleSearchOriginal,
            fields.titleSearchHans,
            fields.contentSearchOriginal,
            fields.contentSearchHans,
            fields.normalizationVersion,
            row.id,
            row.updated_at,
          ],
        });
        updated += write.rowCount || 0;
      }
    }, { role: "jobs", isolation: "read committed", lockTimeoutMs: 1_000 });
    selected += result.rows.length;
    cursor = result.rows.at(-1)!.id;
  }
  return { selected, updated };
}

async function main(): Promise<void> {
  let totalUpdated = 0;
  for (let pass = 1; pass <= MAX_CONFLICT_PASSES; pass += 1) {
    const result = await reindexPass();
    totalUpdated += result.updated;
    if (result.selected === result.updated) {
      process.stdout.write(`Original search index is current; ${totalUpdated} article(s) updated.\n`);
      return;
    }
  }
  throw new Error("Original search reindex could not converge because articles kept changing");
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPools());
