import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import { createContentBlocks } from "./content-text";

/**
 * Ownership of `novel_search_documents`, the relation content search reads.
 *
 * One row per published document, holding that document's whole normalized text as a
 * single contiguous string plus the offsets that map a position in it back to a block.
 * A row exists exactly while its document is published, which is what lets a search
 * establish eligibility by reading this relation alone.
 *
 * The row is written inside the same transaction that publishes the document, so search
 * can never see a document at one generation and its text at another.
 */

export type ContentSearchDocument = {
  /** The document's whole normalized text: every block's search text concatenated. */
  searchText: string;
  /** Normalized offset at which each block starts; `blockStarts.length` is the block count. */
  blockStarts: number[];
};

/**
 * Documents whose published content is complete and current. The search row's existence
 * stands in for all of this at query time, so the writer and the backfill have to agree
 * on it exactly; they share this one definition.
 */
export const PUBLISHED_DOCUMENT_PREDICATE = `d.state IN ('ready', 'building')
  AND d.active_generation > 0
  AND EXISTS (
    SELECT 1 FROM novel_content_generations g
    WHERE g.document_id = d.id AND g.generation = d.active_generation AND g.state = 'published'
  )
  AND EXISTS (
    SELECT 1 FROM novels n
    LEFT JOIN novel_chapters c ON c.novel_id = d.novel_id AND c.id = d.chapter_id
    WHERE n.id = d.novel_id
      AND d.active_content_version = CASE
        WHEN d.chapter_id IS NULL THEN n.published_content_version ELSE c.published_content_version END
  )`;

/** Assembles the document-level form from the blocks a build just produced. */
export function contentSearchDocument(blocks: readonly { searchText: string }[]): ContentSearchDocument {
  const blockStarts: number[] = [];
  let searchText = "";
  for (const block of blocks) {
    blockStarts.push(searchText.length);
    searchText += block.searchText;
  }
  return { searchText, blockStarts };
}

/** Re-derives the document form from stored display text, without the library files. */
export async function rebuildContentSearchDocument(originalText: string): Promise<ContentSearchDocument> {
  const blocks: { searchText: string }[] = [];
  for await (const block of createContentBlocks(originalText)) blocks.push({ searchText: block.searchText });
  return contentSearchDocument(blocks);
}

export async function writeContentSearchDocument(
  executor: SqlExecutor,
  documentId: string,
  generation: number,
  document: ContentSearchDocument,
): Promise<void> {
  // novel_id and source_id are read from the document rather than passed in, so the row
  // cannot disagree with the relation the library filter is maintained against.
  await executor.query({
    text: `INSERT INTO novel_search_documents (document_id, novel_id, source_id, generation, block_starts, search_text)
      SELECT d.id, d.novel_id, d.source_id, $2, $3::integer[], $4
      FROM novel_documents d WHERE d.id = $1
      ON CONFLICT (document_id) DO UPDATE SET
        novel_id = EXCLUDED.novel_id, source_id = EXCLUDED.source_id, generation = EXCLUDED.generation,
        block_starts = EXCLUDED.block_starts, search_text = EXCLUDED.search_text`,
    values: [documentId, generation, document.blockStarts, document.searchText],
  });
}

export type StaleSearchDocument = { documentId: string; generation: number; blockCount: number };

type StaleRow = QueryResultRow & { document_id: string; generation: number; block_count: number };

/**
 * Published documents whose search row is missing or built from a superseded generation,
 * oldest id first so a run that stops can resume from where it left off.
 */
export async function listStaleSearchDocuments(
  executor: SqlExecutor,
  input: { after?: string; limit: number },
): Promise<StaleSearchDocument[]> {
  const limit = input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Invalid search backfill batch size");
  if (input.after !== undefined && !/^\d{1,19}$/u.test(input.after)) throw new Error("Invalid search backfill cursor");
  const result = await executor.query<StaleRow>({
    text: `SELECT d.id::text AS document_id, d.active_generation AS generation, g.block_count
      FROM novel_documents d
      JOIN novel_content_generations g ON g.document_id = d.id AND g.generation = d.active_generation
      LEFT JOIN novel_search_documents s ON s.document_id = d.id AND s.generation = d.active_generation
      WHERE d.id > $1::bigint AND s.document_id IS NULL AND ${PUBLISHED_DOCUMENT_PREDICATE}
      ORDER BY d.id
      LIMIT $2`,
    values: [input.after ?? "0", limit],
  });
  return result.rows.map((row) => ({
    documentId: row.document_id, generation: row.generation, blockCount: row.block_count,
  }));
}

/** Rows left behind by a document that is no longer published; search must not list them. */
export async function deleteOrphanedSearchDocuments(executor: SqlExecutor, limit: number): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) throw new Error("Invalid orphan cleanup batch size");
  const result = await executor.query({
    text: `DELETE FROM novel_search_documents s WHERE s.document_id IN (
        SELECT s2.document_id FROM novel_search_documents s2
        LEFT JOIN novel_documents d ON d.id = s2.document_id AND d.active_generation = s2.generation
        WHERE d.id IS NULL OR NOT (${PUBLISHED_DOCUMENT_PREDICATE})
        LIMIT $1)`,
    values: [limit],
  });
  return result.rowCount ?? 0;
}

type SourceTextRow = QueryResultRow & { original_text: string | null; block_count: string };

/** The document's display text, which the normalizer turns back into its search text. */
export async function readDocumentOriginalText(
  executor: SqlExecutor,
  documentId: string,
  generation: number,
): Promise<{ text: string; blockCount: number }> {
  const result = await executor.query<SourceTextRow>({
    text: `SELECT string_agg(original_text, '' ORDER BY block_no) AS original_text, count(*)::text AS block_count
      FROM novel_content_blocks WHERE document_id = $1 AND generation = $2`,
    values: [documentId, generation],
  });
  const row = result.rows[0];
  return { text: row?.original_text ?? "", blockCount: Number(row?.block_count ?? 0) };
}
