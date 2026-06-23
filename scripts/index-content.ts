import "dotenv/config";

import { getDb } from "../src/lib/db";
import { readNovelContent } from "../src/lib/books";
import { createNovelSegments } from "../src/lib/segments";
import type { Novel } from "../src/lib/books";

type IndexStats = {
  candidates: number;
  indexed: number;
  skipped: number;
  failed: number;
};

function readLimit(): number | null {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  if (!limitArg) {
    return null;
  }

  const value = Number(limitArg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

async function main() {
  const db = getDb();
  const limit = readLimit();

  const novels = db
    .prepare(
      `
      SELECT n.id, n.title, n.file_name, n.relative_path, n.content_hash, n.size_bytes, n.mtime_ms, n.created_at, n.updated_at
      FROM novels n
      LEFT JOIN search_index_state s ON s.novel_id = n.id
      WHERE s.novel_id IS NULL
         OR s.size_bytes != n.size_bytes
         OR s.mtime_ms != n.mtime_ms
         OR s.status != 'indexed'
      ORDER BY n.id ASC
      ${limit ? "LIMIT ?" : ""}
    `,
    )
    .all(...(limit ? [limit] : [])) as Novel[];

  const deleteFts = db.prepare("DELETE FROM novel_segments_fts WHERE novel_id = ?");
  const deleteSegments = db.prepare("DELETE FROM novel_segments WHERE novel_id = ?");
  const insertSegment = db.prepare(`
    INSERT INTO novel_segments (novel_id, segment_index, char_start, char_end, content, updated_at)
    VALUES (@novelId, @segmentIndex, @charStart, @charEnd, @content, CURRENT_TIMESTAMP)
  `);
  const insertFts = db.prepare(`
    INSERT INTO novel_segments_fts (title, content, novel_id, segment_index, char_start, char_end)
    VALUES (@title, @content, @novelId, @segmentIndex, @charStart, @charEnd)
  `);
  const upsertState = db.prepare(`
    INSERT INTO search_index_state (novel_id, size_bytes, mtime_ms, segment_count, status, error, indexed_at)
    VALUES (@novelId, @sizeBytes, @mtimeMs, @segmentCount, @status, @error, CURRENT_TIMESTAMP)
    ON CONFLICT(novel_id) DO UPDATE SET
      size_bytes = excluded.size_bytes,
      mtime_ms = excluded.mtime_ms,
      segment_count = excluded.segment_count,
      status = excluded.status,
      error = excluded.error,
      indexed_at = CURRENT_TIMESTAMP
  `);

  const stats: IndexStats = {
    candidates: novels.length,
    indexed: 0,
    skipped: 0,
    failed: 0,
  };

  for (const novel of novels) {
    try {
      const content = await readNovelContent(novel);
      const segments = createNovelSegments(content);

      db.exec("BEGIN");
      try {
        deleteFts.run(novel.id);
        deleteSegments.run(novel.id);

        for (const segment of segments) {
          insertSegment.run({
            novelId: novel.id,
            segmentIndex: segment.segmentIndex,
            charStart: segment.charStart,
            charEnd: segment.charEnd,
            content: segment.content,
          });
          insertFts.run({
            title: novel.title,
            content: segment.content,
            novelId: novel.id,
            segmentIndex: segment.segmentIndex,
            charStart: segment.charStart,
            charEnd: segment.charEnd,
          });
        }

        upsertState.run({
          novelId: novel.id,
          sizeBytes: novel.size_bytes,
          mtimeMs: novel.mtime_ms,
          segmentCount: segments.length,
          status: "indexed",
          error: null,
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      stats.indexed += 1;
      console.log(`indexed ${novel.id}: ${novel.title} (${segments.length} segments)`);
    } catch (error) {
      stats.failed += 1;
      upsertState.run({
        novelId: novel.id,
        sizeBytes: novel.size_bytes,
        mtimeMs: novel.mtime_ms,
        segmentCount: 0,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`failed ${novel.id}: ${novel.title}`);
    }
  }

  console.log(`待处理: ${stats.candidates}`);
  console.log(`已索引: ${stats.indexed}`);
  console.log(`失败: ${stats.failed}`);
  console.log(`跳过: ${stats.skipped}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
