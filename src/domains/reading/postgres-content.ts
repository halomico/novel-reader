import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { contentVersionForText } from "@/lib/content-version";
import { CONTENT_NORMALIZATION_VERSION, createContentBlocks, type ContentBlock } from "./content-text";
import { contentSearchDocument, writeContentSearchDocument, type ContentSearchDocument } from "./postgres-search-index";

const MAX_BATCH_BLOCKS = 128;
const MAX_BATCH_BYTES = 1_048_576;
type RunTransaction = typeof withTransaction;
export type ContentBuild = {
  documentId: string;
  generation: number;
  buildToken: string;
  contentVersion: string;
};
export type BeginContentBuildInput = {
  novelId: number;
  chapterId?: number | null;
  sourceContentVersion: string;
  expectedPublishedVersion: string | null;
  contentVersion: string;
  totalUtf16Length: number;
};
type DocumentRow = QueryResultRow & {
  id: string; novel_id: number; chapter_id: number | null; active_generation: number;
  active_content_version: string | null; staging_generation: number | null; next_generation: number;
};
type GenerationRow = QueryResultRow & {
  build_token: string; source_content_version: string; expected_published_version: string | null;
  content_version: string; total_utf16_length: number; stored_utf16_length: number; block_count: number; state: string;
};

export class ContentVersionChangedError extends Error {
  readonly code = "CONTENT_VERSION_CHANGED";
  constructor(readonly currentContentVersion: string | null) {
    super("The content version changed; reload the document before resolving this position");
  }
}
export class ContentBuildSupersededError extends Error {
  readonly code = "CONTENT_BUILD_SUPERSEDED";
  constructor() { super("The source content or active build changed; this build cannot be published"); }
}
export class ContentNotPublishedError extends Error {
  readonly code = "CONTENT_NOT_PUBLISHED";
  constructor() { super("No complete published content is available for this document"); }
}

function validateOwner(novelId: number, chapterId?: number | null): void {
  if (!Number.isSafeInteger(novelId) || novelId < 1 || (chapterId != null && (!Number.isSafeInteger(chapterId) || chapterId < 1))) {
    throw new Error("Invalid content owner");
  }
}
async function lockCatalogOwner(transaction: SqlExecutor, novelId: number, chapterId: number | null) {
  // Keep one lock order for single-file and chapter publication: novel, chapter,
  // document, generation. This also serializes concurrent book deletion safely.
  const novel = await transaction.query<{ content_hash: string | null; published_content_version: string | null }>({
    text: "SELECT content_hash, published_content_version FROM novels WHERE id = $1 FOR UPDATE", values: [novelId],
  });
  if (!novel.rows[0]) throw new Error("Novel does not exist");
  if (chapterId === null) return novel.rows[0];
  const chapter = await transaction.query<{ content_hash: string | null; published_content_version: string | null }>({
    text: "SELECT content_hash, published_content_version FROM novel_chapters WHERE novel_id = $1 AND id = $2 FOR UPDATE",
    values: [novelId, chapterId],
  });
  if (!chapter.rows[0]) throw new Error("Chapter does not belong to this novel");
  return chapter.rows[0];
}

export async function beginContentBuild(input: BeginContentBuildInput, transaction: RunTransaction = withTransaction): Promise<ContentBuild> {
  validateOwner(input.novelId, input.chapterId);
  if (!input.sourceContentVersion || !input.contentVersion || !Number.isSafeInteger(input.totalUtf16Length) || input.totalUtf16Length < 0 || input.totalUtf16Length > 2_147_483_647) {
    throw new Error("Invalid content manifest");
  }
  return transaction(async (tx) => {
    const chapterId = input.chapterId ?? null;
    const owner = await lockCatalogOwner(tx, input.novelId, chapterId);
    if (owner.content_hash !== input.sourceContentVersion) throw new ContentBuildSupersededError();
    if (owner.published_content_version !== input.expectedPublishedVersion) throw new ContentVersionChangedError(owner.published_content_version);
    await tx.query({
      text: "INSERT INTO novel_documents (novel_id, chapter_id) VALUES ($1, $2) ON CONFLICT (novel_id, chapter_id) DO NOTHING",
      values: [input.novelId, chapterId],
    });
    const documents = await tx.query<DocumentRow>({
      text: `SELECT id, novel_id, chapter_id, active_generation, active_content_version,
        staging_generation, next_generation FROM novel_documents
        WHERE novel_id = $1 AND chapter_id IS NOT DISTINCT FROM $2 FOR UPDATE`, values: [input.novelId, chapterId],
    });
    const document = documents.rows[0];
    if (document.active_content_version !== input.expectedPublishedVersion) throw new ContentVersionChangedError(document.active_content_version);
    if (document.next_generation >= 2_147_483_647) throw new Error("Content generation exhausted");
    const build: ContentBuild = { documentId: document.id, generation: document.next_generation, buildToken: randomUUID(), contentVersion: input.contentVersion };
    if (document.staging_generation !== null) await tx.query({
      text: "UPDATE novel_content_generations SET state = 'obsolete', updated_at = clock_timestamp() WHERE document_id = $1 AND generation = $2",
      values: [document.id, document.staging_generation],
    });
    await tx.query({
      text: `INSERT INTO novel_content_generations
        (document_id, generation, build_token, source_content_version, expected_published_version, content_version, normalization_version, total_utf16_length)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [build.documentId, build.generation, build.buildToken, input.sourceContentVersion, input.expectedPublishedVersion, input.contentVersion, CONTENT_NORMALIZATION_VERSION, input.totalUtf16Length],
    });
    await tx.query({
      text: `UPDATE novel_documents SET next_generation = next_generation + 1, staging_generation = $2,
        staging_content_version = $3, state = 'building', last_error = NULL, updated_at = clock_timestamp() WHERE id = $1`,
      values: [document.id, build.generation, input.contentVersion],
    });
    return build;
  }, { role: "jobs" });
}

async function lockBuild(tx: SqlExecutor, build: ContentBuild): Promise<{ document: DocumentRow; manifest: GenerationRow }> {
  const documents = await tx.query<DocumentRow>({
    text: `SELECT id, novel_id, chapter_id, active_generation, active_content_version,
      staging_generation, next_generation FROM novel_documents WHERE id = $1 FOR UPDATE`, values: [build.documentId],
  });
  const document = documents.rows[0];
  if (!document || document.staging_generation !== build.generation) throw new ContentBuildSupersededError();
  const generations = await tx.query<GenerationRow>({
    text: `SELECT build_token, source_content_version, expected_published_version, content_version,
      total_utf16_length, stored_utf16_length, block_count, state FROM novel_content_generations
      WHERE document_id = $1 AND generation = $2 AND build_token = $3 FOR UPDATE`,
    values: [build.documentId, build.generation, build.buildToken],
  });
  const manifest = generations.rows[0];
  if (!manifest || manifest.state !== "building" || manifest.content_version !== build.contentVersion) throw new ContentBuildSupersededError();
  return { document, manifest };
}

function serializedBlocks(blocks: readonly ContentBlock[]): string {
  if (blocks.length < 1 || blocks.length > MAX_BATCH_BLOCKS) throw new Error(`A content batch must contain 1–${MAX_BATCH_BLOCKS} blocks`);
  const json = JSON.stringify(blocks.map((block) => ({
    block_no: block.blockNo, char_start: block.charStart, char_end: block.charEnd, original_text: block.originalText,
  })));
  if (Buffer.byteLength(json) > MAX_BATCH_BYTES) throw new Error("Content batch exceeds the byte budget");
  return json;
}

/** Each batch has its own short transaction. A retry of the same committed batch
 * is verified byte-for-byte; it never silently accepts different replacement text.
 */
export async function appendContentBuildBatch(build: ContentBuild, blocks: readonly ContentBlock[], transaction: RunTransaction = withTransaction): Promise<void> {
  const json = serializedBlocks(blocks);
  await transaction(async (tx) => {
    const { manifest } = await lockBuild(tx, build);
    let expectedBlock = blocks[0].blockNo;
    let expectedOffset = blocks[0].charStart;
    for (const block of blocks) {
      if (!Number.isSafeInteger(block.blockNo) || block.blockNo !== expectedBlock || block.charStart !== expectedOffset ||
        !block.originalText || !block.originalText.isWellFormed() || block.originalText.includes("\0") ||
        block.charEnd !== block.charStart + block.originalText.length ||
        block.charEnd > manifest.total_utf16_length) throw new Error("Invalid or non-contiguous content blocks");
      expectedBlock += 1;
      expectedOffset = block.charEnd;
    }
    if (blocks[0].blockNo < manifest.block_count) {
      const existing = await tx.query<{ equal: boolean }>({
        text: `SELECT count(*) = $4 AND coalesce(bool_and(
          b.char_start = p.char_start AND b.char_end = p.char_end AND b.original_text = p.original_text), false) AS equal
          FROM jsonb_to_recordset($3::jsonb) AS p(block_no integer, char_start integer, char_end integer, original_text text)
          JOIN novel_content_blocks b ON b.document_id = $1 AND b.generation = $2 AND b.block_no = p.block_no`,
        values: [build.documentId, build.generation, json, blocks.length],
      });
      if (!existing.rows[0]?.equal) throw new Error("Content batch retry differs from committed data");
      return;
    }
    if (blocks[0].blockNo !== manifest.block_count || blocks[0].charStart !== manifest.stored_utf16_length || expectedOffset > manifest.total_utf16_length) {
      throw new Error("Content batch is out of sequence");
    }
    await tx.query({
      text: `INSERT INTO novel_content_blocks (document_id, generation, block_no, char_start, char_end, original_text)
        SELECT $1, $2, block_no, char_start, char_end, original_text
        FROM jsonb_to_recordset($3::jsonb) AS p(block_no integer, char_start integer, char_end integer, original_text text)`,
      values: [build.documentId, build.generation, json],
    });
    await tx.query({
      text: `UPDATE novel_content_generations SET stored_utf16_length = $3, block_count = $4,
        updated_at = clock_timestamp() WHERE document_id = $1 AND generation = $2`,
      values: [build.documentId, build.generation, expectedOffset, expectedBlock],
    });
  }, { role: "jobs" });
}

/**
 * Makes the build the published content and, in the same transaction, replaces the
 * document's search row. Search reads that row alone, so publishing text and publishing
 * its searchable form cannot come apart: there is no window in which a reader sees the
 * new generation while search still answers from the old one, or the reverse.
 */
export async function publishContentBuild(
  build: ContentBuild,
  search: ContentSearchDocument,
  transaction: RunTransaction = withTransaction,
): Promise<ContentBuild> {
  return transaction(async (tx) => {
    const location = await tx.query<{ novel_id: number; chapter_id: number | null }>({
      text: "SELECT novel_id, chapter_id FROM novel_documents WHERE id = $1", values: [build.documentId],
    });
    if (!location.rows[0]) throw new ContentBuildSupersededError();
    const { novel_id: novelId, chapter_id: chapterId } = location.rows[0];
    const owner = await lockCatalogOwner(tx, novelId, chapterId);
    const { document, manifest } = await lockBuild(tx, build);
    if (owner.content_hash !== manifest.source_content_version || owner.published_content_version !== manifest.expected_published_version ||
      document.active_content_version !== manifest.expected_published_version) throw new ContentBuildSupersededError();
    if (manifest.stored_utf16_length !== manifest.total_utf16_length) throw new Error("Cannot publish incomplete content");
    const ownerUpdate = await tx.query({
      text: chapterId === null
        ? "UPDATE novels SET published_content_version = $2 WHERE id = $1 AND content_hash = $3 AND published_content_version IS NOT DISTINCT FROM $4"
        : "UPDATE novel_chapters SET published_content_version = $2 WHERE id = $1 AND content_hash = $3 AND published_content_version IS NOT DISTINCT FROM $4",
      values: [chapterId ?? novelId, manifest.content_version, manifest.source_content_version, manifest.expected_published_version],
    });
    if (ownerUpdate.rowCount !== 1) throw new ContentBuildSupersededError();
    await tx.query({
      text: `UPDATE novel_content_generations SET state = CASE WHEN generation = $2 THEN 'published' ELSE 'obsolete' END,
        updated_at = clock_timestamp() WHERE document_id = $1 AND generation IN ($2, $3)`,
      values: [build.documentId, build.generation, document.active_generation],
    });
    await tx.query({
      text: `UPDATE novel_documents SET active_generation = $2, active_content_version = $3, normalization_version = $4,
        staging_generation = NULL, staging_content_version = NULL, state = 'ready', last_error = NULL,
        indexed_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`,
      values: [build.documentId, build.generation, build.contentVersion, CONTENT_NORMALIZATION_VERSION],
    });
    if (search.blockStarts.length !== manifest.block_count) throw new Error("Search text does not cover the published blocks");
    await writeContentSearchDocument(tx, build.documentId, build.generation, search);
    return build;
  }, { role: "jobs" });
}

export async function abandonContentBuild(build: ContentBuild, transaction: RunTransaction = withTransaction): Promise<void> {
  await transaction(async (tx) => {
    const result = await tx.query({
      text: `UPDATE novel_documents d SET staging_generation = NULL, staging_content_version = NULL,
        state = CASE WHEN active_generation > 0 THEN 'ready' ELSE 'failed' END, last_error = 'Content build did not complete', updated_at = clock_timestamp()
        WHERE id = $1 AND staging_generation = $2 AND EXISTS (SELECT 1 FROM novel_content_generations g
          WHERE g.document_id = d.id AND g.generation = $2 AND g.build_token = $3)`,
      values: [build.documentId, build.generation, build.buildToken],
    });
    if (result.rowCount) await tx.query({
      text: "UPDATE novel_content_generations SET state = 'failed', updated_at = clock_timestamp() WHERE document_id = $1 AND generation = $2",
      values: [build.documentId, build.generation],
    });
  }, { role: "jobs" });
}

export async function publishPostgresContent(
  input: Omit<BeginContentBuildInput, "contentVersion" | "totalUtf16Length"> & { text: string; signal?: AbortSignal },
  transaction: RunTransaction = withTransaction,
): Promise<ContentBuild> {
  input.signal?.throwIfAborted();
  const build = await beginContentBuild({ ...input, totalUtf16Length: input.text.length,
    contentVersion: contentVersionForText(input.text) }, transaction);
  try {
    let batch: ContentBlock[] = [];
    let bytes = 0;
    // Blocks stream to keep one batch in memory; the normalized text does not, because a
    // document is indexed whole. Even the longest novels in the library are a few hundred
    // thousand characters, so this holds well under a megabyte.
    const searchBlocks: { searchText: string }[] = [];
    for await (const block of createContentBlocks(input.text)) {
      input.signal?.throwIfAborted();
      searchBlocks.push({ searchText: block.searchText });
      const blockBytes = Buffer.byteLength(block.originalText) + 64;
      if (batch.length && (batch.length >= 64 || bytes + blockBytes > MAX_BATCH_BYTES / 2)) {
        await appendContentBuildBatch(build, batch, transaction);
        batch = []; bytes = 0;
      }
      batch.push(block); bytes += blockBytes;
    }
    if (batch.length) await appendContentBuildBatch(build, batch, transaction);
    input.signal?.throwIfAborted();
    return await publishContentBuild(build, contentSearchDocument(searchBlocks), transaction);
  } catch (error) {
    await abandonContentBuild(build, transaction).catch(() => { /* Original build failure remains the actionable error. */ });
    throw error;
  }
}

export type PublishedContentBlock = { blockNo: number; charStart: number; charEnd: number; originalText: string };
export type PublishedContentWindow = {
  documentId: string; contentVersion: string; generation: number; totalUtf16Length: number; blockCount: number; blocks: PublishedContentBlock[];
};

type PublishedNovelContentRow = QueryResultRow & {
  id: string;
  active_content_version: string | null;
  active_generation: number;
  published_content_version: string | null;
  total_utf16_length: number | null;
  block_count: number | null;
  block_no: number | null;
  char_start: number | null;
  char_end: number | null;
  original_text: string | null;
};

function validatePublishedContentOwner(novelId: number, chapterId: number | null): void {
  if (!Number.isSafeInteger(novelId) || novelId < 1 ||
      chapterId !== null && (!Number.isSafeInteger(chapterId) || chapterId < 1)) {
    throw new Error("Invalid published content owner");
  }
}

/**
 * Reads the authoritative published body for one reader route from PostgreSQL.
 * The manifest and blocks come from one MVCC statement, so a concurrent
 * publication can never splice two content versions into the same response.
 * A preview only transfers the leading fraction instead of loading the paid
 * body and trimming it after it has crossed the database boundary.
 */
export async function readPublishedNovelContent(
  executor: SqlExecutor,
  input: { novelId: number; chapterId?: number | null; previewRatio?: number },
): Promise<PublishedContentWindow> {
  const chapterId = input.chapterId ?? null;
  validatePublishedContentOwner(input.novelId, chapterId);
  const previewRatio = input.previewRatio ?? 1;
  if (!Number.isFinite(previewRatio) || previewRatio <= 0 || previewRatio > 1) {
    throw new Error("Invalid published content preview ratio");
  }
  const result = await executor.query<PublishedNovelContentRow>({
    name: "reading-published-novel-content-v1",
    text: `SELECT d.id, d.active_content_version, d.active_generation,
      CASE WHEN d.chapter_id IS NULL THEN n.published_content_version ELSE c.published_content_version END AS published_content_version,
      g.total_utf16_length, g.block_count,
      b.block_no, b.char_start, b.char_end, b.original_text
      FROM novel_documents d
      JOIN novels n ON n.id = d.novel_id
      LEFT JOIN novel_chapters c ON c.id = d.chapter_id AND c.novel_id = d.novel_id
      LEFT JOIN novel_content_generations g
        ON g.document_id = d.id AND g.generation = d.active_generation AND g.state = 'published'
      LEFT JOIN LATERAL (
        SELECT block.block_no, block.char_start, block.char_end, block.original_text
        FROM novel_content_blocks block
        WHERE block.document_id = d.id
          AND block.generation = d.active_generation
          AND ($3::double precision >= 1 OR block.char_start < ceil(g.total_utf16_length * $3))
        ORDER BY block.block_no
      ) b ON true
      WHERE d.novel_id = $1 AND d.chapter_id IS NOT DISTINCT FROM $2::integer
      ORDER BY b.block_no NULLS LAST`,
    values: [input.novelId, chapterId, previewRatio],
  });
  const row = result.rows[0];
  if (!row?.active_content_version || row.active_content_version !== row.published_content_version ||
      row.total_utf16_length === null || row.block_count === null) {
    throw new ContentNotPublishedError();
  }
  const previewEnd = previewRatio < 1
    ? Math.max(1, Math.ceil(row.total_utf16_length * previewRatio))
    : row.total_utf16_length;
  const blocks = result.rows.flatMap((blockRow) => {
    if (blockRow.block_no === null || blockRow.char_start === null || blockRow.char_end === null || blockRow.original_text === null) {
      return [];
    }
    const block: PublishedContentBlock = {
      blockNo: blockRow.block_no,
      charStart: blockRow.char_start,
      charEnd: blockRow.char_end,
      originalText: blockRow.original_text,
    };
    if (block.charStart >= previewEnd) return [];
    if (block.charEnd <= previewEnd) return [block];
    const originalText = block.originalText.slice(0, Math.max(previewEnd - block.charStart, 0));
    return originalText.length
      ? [{ ...block, charEnd: block.charStart + originalText.length, originalText }]
      : [];
  });
  return {
    documentId: row.id,
    contentVersion: row.active_content_version,
    generation: row.active_generation,
    totalUtf16Length: previewEnd,
    blockCount: previewRatio < 1 ? blocks.length : row.block_count,
    blocks,
  };
}

/** One statement snapshot prevents mixed-version reads during publication or
 * cleanup. Authorization belongs to the calling use case before content delivery.
 */
export async function readPublishedContentWindow(executor: SqlExecutor, input: {
  documentId: string; contentVersion?: string; blockNo?: number; neighbors?: 0 | 1;
}): Promise<PublishedContentWindow> {
  const blockNo = input.blockNo ?? 0;
  const neighbors = input.neighbors ?? 1;
  if (!/^\d+$/u.test(input.documentId) || !Number.isSafeInteger(blockNo) || blockNo < 0 || (neighbors !== 0 && neighbors !== 1)) throw new Error("Invalid content window");
  const result = await executor.query<{
    id: string; active_content_version: string | null; active_generation: number; published_content_version: string | null;
    total_utf16_length: number | null; block_count: number | null; blocks: PublishedContentBlock[];
  }>({
    text: `SELECT d.id, d.active_content_version, d.active_generation,
      CASE WHEN d.chapter_id IS NULL THEN n.published_content_version ELSE c.published_content_version END AS published_content_version,
      g.total_utf16_length, g.block_count,
      coalesce((SELECT jsonb_agg(jsonb_build_object('blockNo', b.block_no, 'charStart', b.char_start,
        'charEnd', b.char_end, 'originalText', b.original_text) ORDER BY b.block_no)
        FROM novel_content_blocks b WHERE b.document_id = d.id AND b.generation = d.active_generation
          AND b.block_no BETWEEN $2 AND $3), '[]'::jsonb) AS blocks
      FROM novel_documents d JOIN novels n ON n.id = d.novel_id
      LEFT JOIN novel_chapters c ON c.id = d.chapter_id AND c.novel_id = d.novel_id
      LEFT JOIN novel_content_generations g ON g.document_id = d.id AND g.generation = d.active_generation AND g.state = 'published'
      WHERE d.id = $1`,
    values: [input.documentId, Math.max(0, blockNo - neighbors), blockNo + neighbors],
  });
  const row = result.rows[0];
  if (input.contentVersion !== undefined && row?.active_content_version !== input.contentVersion) throw new ContentVersionChangedError(row?.active_content_version ?? null);
  if (!row?.active_content_version || row.active_content_version !== row.published_content_version || row.total_utf16_length === null || row.block_count === null) throw new ContentNotPublishedError();
  if (blockNo >= Math.max(row.block_count, 1)) throw new RangeError("Content block is outside the published document");
  return { documentId: row.id, contentVersion: row.active_content_version, generation: row.active_generation,
    totalUtf16Length: row.total_utf16_length, blockCount: row.block_count, blocks: row.blocks };
}

export async function cleanupContentGenerations(executor: SqlExecutor, limit = 256): Promise<{ blocksDeleted: number; generationsDeleted: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50_000) throw new Error("Invalid content cleanup budget");
  const blocks = await executor.query({
    text: `WITH victims AS (SELECT b.document_id, b.generation, b.block_no FROM novel_content_blocks b
      JOIN novel_documents d ON d.id = b.document_id
      WHERE b.generation <> d.active_generation AND b.generation IS DISTINCT FROM d.staging_generation
      ORDER BY b.document_id, b.generation, b.block_no LIMIT $1 FOR UPDATE OF b SKIP LOCKED)
      DELETE FROM novel_content_blocks b USING victims v
      WHERE (b.document_id, b.generation, b.block_no) = (v.document_id, v.generation, v.block_no)`, values: [limit],
  });
  const generations = await executor.query({
    text: `WITH victims AS (SELECT g.document_id, g.generation FROM novel_content_generations g
      JOIN novel_documents d ON d.id = g.document_id
      WHERE g.generation <> d.active_generation AND g.generation IS DISTINCT FROM d.staging_generation
        AND NOT EXISTS (SELECT 1 FROM novel_content_blocks b WHERE b.document_id = g.document_id AND b.generation = g.generation)
      ORDER BY g.updated_at, g.document_id, g.generation LIMIT $1 FOR UPDATE OF g SKIP LOCKED)
      DELETE FROM novel_content_generations g USING victims v WHERE (g.document_id, g.generation) = (v.document_id, v.generation)`, values: [limit],
  });
  return { blocksDeleted: blocks.rowCount ?? 0, generationsDeleted: generations.rowCount ?? 0 };
}

/**
 * Reclaims generations that publication or a restarted build retired. Unlike the full
 * sweep above, victims come from the generation manifest (its cleanup index) and blocks
 * are deleted by primary-key prefix, so the cost follows what is deleted rather than the
 * size of the library. An indexing job calls it after every batch: a rebuild then frees
 * each old generation as soon as its replacement is live, and autovacuum hands that
 * space to the following batches instead of the table holding two copies of the library.
 */
export async function cleanupRetiredContentGenerations(
  executor: SqlExecutor,
  limit = 64,
): Promise<{ blocksDeleted: number; generationsDeleted: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Invalid content cleanup budget");
  const result = await executor.query<QueryResultRow & { blocks: string | number; generations: string | number }>({
    text: `WITH victims AS (
        SELECT g.document_id, g.generation FROM novel_content_generations g
        JOIN novel_documents d ON d.id = g.document_id
        WHERE g.state IN ('obsolete', 'failed')
          AND g.generation <> d.active_generation AND g.generation IS DISTINCT FROM d.staging_generation
        ORDER BY g.updated_at, g.document_id, g.generation
        LIMIT $1 FOR UPDATE OF g SKIP LOCKED
      ), deleted_blocks AS (
        DELETE FROM novel_content_blocks b USING victims v
        WHERE b.document_id = v.document_id AND b.generation = v.generation
        RETURNING 1
      ), deleted_generations AS (
        DELETE FROM novel_content_generations g USING victims v
        WHERE g.document_id = v.document_id AND g.generation = v.generation
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM deleted_blocks) AS blocks, (SELECT count(*) FROM deleted_generations) AS generations`,
    values: [limit],
  });
  return {
    blocksDeleted: Number(result.rows[0]?.blocks ?? 0),
    generationsDeleted: Number(result.rows[0]?.generations ?? 0),
  };
}
