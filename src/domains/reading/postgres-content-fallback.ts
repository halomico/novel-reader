import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import { getLibraryDir } from "@/lib/config";
import { CONTENT_BLOCK_CODE_POINTS } from "./content-text";
import type { PublishedContentBlock, PublishedContentWindow } from "./postgres-content";
import { readVerifiedPostgresContentSource } from "./postgres-content-reindex";

/**
 * Reading a book whose search index is not built yet.
 *
 * Indexing 10 GB of novels takes hours, and a reader who opens a book in that window
 * should get the book, not a placeholder. The indexed path stays authoritative: this
 * one runs only after it reports no published content, and it reads the very same
 * library file the indexer will read, verified against the hash the catalog recorded.
 * A file that changed on disk since the catalog scan is refused rather than served,
 * because its offsets would no longer agree with stored reading progress or with
 * search hits once the index does land.
 */

type SourceRow = QueryResultRow & {
  relative_path: string | null;
  content_hash: string | null;
};

/**
 * Split the text exactly where `createContentBlocks` splits it — every
 * CONTENT_BLOCK_CODE_POINTS code points, with offsets counted in UTF-16 units. The
 * normalization the indexer also performs is search-only, so it is not repeated here;
 * what matters is that a block number and a character offset mean the same position
 * before and after the index catches up.
 */
function sourceBlocks(text: string): PublishedContentBlock[] {
  const blocks: PublishedContentBlock[] = [];
  let charStart = 0;
  let charEnd = 0;
  let codePoints = 0;
  const push = (start: number, end: number) => {
    blocks.push({ blockNo: blocks.length, charStart: start, charEnd: end, originalText: text.slice(start, end) });
  };
  for (const character of text) {
    charEnd += character.length;
    codePoints += 1;
    if (codePoints < CONTENT_BLOCK_CODE_POINTS) continue;
    push(charStart, charEnd);
    charStart = charEnd;
    codePoints = 0;
  }
  if (charEnd > charStart) push(charStart, charEnd);
  return blocks;
}

export class ContentSourceUnavailableError extends Error {
  readonly code = "CONTENT_SOURCE_UNAVAILABLE";
  constructor(message: string) { super(message); }
}

export async function readNovelContentFromSource(
  executor: SqlExecutor,
  input: { novelId: number; chapterId?: number | null; previewRatio?: number },
  libraryRoot: string = getLibraryDir(),
): Promise<PublishedContentWindow> {
  const chapterId = input.chapterId ?? null;
  if (!Number.isSafeInteger(input.novelId) || input.novelId < 1
    || (chapterId !== null && (!Number.isSafeInteger(chapterId) || chapterId < 1))) {
    throw new Error("Invalid content owner");
  }
  const previewRatio = input.previewRatio ?? 1;
  if (!Number.isFinite(previewRatio) || previewRatio <= 0 || previewRatio > 1) {
    throw new Error("Invalid published content preview ratio");
  }

  const result = await executor.query<SourceRow>({
    name: "reading-content-source-location-v1",
    text: `SELECT
      CASE WHEN $2::integer IS NULL THEN n.relative_path ELSE c.relative_path END AS relative_path,
      CASE WHEN $2::integer IS NULL THEN n.content_hash ELSE c.content_hash END AS content_hash
      FROM novels n
      LEFT JOIN novel_chapters c ON c.novel_id = n.id AND c.id = $2::integer
      WHERE n.id = $1 AND ($2::integer IS NULL OR c.id IS NOT NULL)`,
    values: [input.novelId, chapterId],
  });
  const row = result.rows[0];
  const relativePath = row?.relative_path || "";
  const sourceContentVersion = (row?.content_hash || "").toLocaleLowerCase("en-US");
  if (!relativePath || !/^[0-9a-f]{64}$/u.test(sourceContentVersion)) {
    throw new ContentSourceUnavailableError("No catalogued source file for this document");
  }

  const source = await readVerifiedPostgresContentSource(libraryRoot, { relativePath, sourceContentVersion });
  const totalUtf16Length = source.text.length;
  const previewEnd = previewRatio < 1
    ? Math.max(1, Math.ceil(totalUtf16Length * previewRatio))
    : totalUtf16Length;
  const blocks = sourceBlocks(source.text).flatMap((block) => {
    if (block.charStart >= previewEnd) return [];
    if (block.charEnd <= previewEnd) return [block];
    const originalText = block.originalText.slice(0, Math.max(previewEnd - block.charStart, 0));
    return originalText.length
      ? [{ ...block, charEnd: block.charStart + originalText.length, originalText }]
      : [];
  });

  return {
    // Not a generation: this content never went through a build. The prefix also keeps
    // the localization cache from ever mixing a source read with a published version.
    documentId: `source:${input.novelId}:${chapterId ?? ""}`,
    contentVersion: `source:${sourceContentVersion}`,
    generation: 0,
    totalUtf16Length: previewEnd,
    blockCount: blocks.length,
    blocks,
  };
}
