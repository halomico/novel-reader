import crypto from "node:crypto";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { readNovelContent, type Novel } from "./books";
import {
  getContentIndexDatabasePath,
  getContentIndexHardLimitBytes,
  getContentIndexMaxSegments,
  getContentIndexSoftLimitBytes,
  getContentIndexTerms,
} from "./config";
import { getContentIndexDb } from "./content-index-db";
import { createNovelSegments } from "./segments";
import { normalizeSearchText } from "./search-query";

export type ContentIndexSource = "auto" | "manual";

export type ContentIndexTermStatus = {
  term: string;
  segmentCount: number;
  status: "indexed" | "skipped";
  source?: ContentIndexSource;
};

export type ContentIndexSummary = ContentIndexTermStatus & {
  novelCount: number;
  source: ContentIndexSource;
  hitCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
};

export type ContentIndexBuildProgress = {
  totalBooks: number;
  scannedBooks: number;
  matchedBooks: number;
  segmentCount: number;
  completedTerms?: number;
  totalTerms?: number;
};

export type ContentIndexBuildOptions = {
  source?: ContentIndexSource;
  maxSegments?: number | null;
  isCancelled?: () => boolean;
};

export type ContentIndexStorageSummary = {
  databasePath: string;
  databaseBytes: number;
  softLimitBytes: number;
  hardLimitBytes: number;
  termCount: number;
  autoTermCount: number;
  manualTermCount: number;
};

export type IndexedContentCandidatePlan = {
  terms: string[];
  requestedTerms: string[];
  novelIds: number[];
};

type ContentIndexLimitOptions = {
  maxSegments?: number | null;
  source?: ContentIndexSource;
  enforceBudget?: boolean;
};

export class ContentIndexCancelledError extends Error {
  constructor() {
    super("索引任务已取消");
    this.name = "ContentIndexCancelledError";
  }
}

export function normalizeContentIndexTerms(values = getContentIndexTerms()): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const value of values) {
    const term = normalizeSearchText(value);
    if (term && !seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  }

  return terms;
}

export function normalizeContentIndexTerm(value: string): string {
  return normalizeContentIndexTerms([value])[0] || "";
}

function relatedIndexPaths(): string[] {
  const databasePath = getContentIndexDatabasePath();
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function getContentIndexDiskUsageBytes(): number {
  return relatedIndexPaths().reduce((total, filePath) => total + fileSize(filePath), 0);
}

function vacuumContentIndex(db: DatabaseSync) {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.exec("VACUUM;");
}

function deleteContentIndexTermRows(db: DatabaseSync, term: string) {
  db.prepare("DELETE FROM content_search_terms WHERE term = ?").run(term);
  db.prepare("DELETE FROM content_search_term_stats WHERE term = ?").run(term);
}

function refreshNovelCountsForTerms(db: DatabaseSync, terms: string[]) {
  if (!terms.length) {
    return;
  }

  const countTerm = db.prepare("SELECT COUNT(*) AS count FROM content_search_terms WHERE term = ?");
  const updateTerm = db.prepare("UPDATE content_search_term_stats SET novel_count = ?, updated_at = CURRENT_TIMESTAMP WHERE term = ?");
  for (const term of terms) {
    const row = countTerm.get(term) as { count: number };
    updateTerm.run(row.count, term);
  }
}

export function pruneColdAutoIndexes(db = getContentIndexDb(), targetBytes = getContentIndexSoftLimitBytes()): string[] {
  const deleted: string[] = [];
  let usage = getContentIndexDiskUsageBytes();
  if (usage <= targetBytes) {
    return deleted;
  }

  const coldTerms = db
    .prepare(
      `
      SELECT term
      FROM content_search_term_stats
      WHERE source = 'auto'
      ORDER BY
        COALESCE(last_used_at, '1970-01-01') ASC,
        hit_count ASC,
        updated_at ASC,
        segment_count DESC
    `,
    )
    .all() as Array<{ term: string }>;

  for (const row of coldTerms) {
    deleteContentIndexTermRows(db, row.term);
    deleted.push(row.term);
    if (deleted.length % 20 === 0) {
      vacuumContentIndex(db);
    }
    usage = getContentIndexDiskUsageBytes();
    if (usage <= targetBytes) {
      break;
    }
  }

  if (deleted.length) {
    vacuumContentIndex(db);
  }

  return deleted;
}

export function enforceContentIndexBudget(db = getContentIndexDb()): string[] {
  if (getContentIndexDiskUsageBytes() <= getContentIndexSoftLimitBytes()) {
    return [];
  }
  return pruneColdAutoIndexes(db, getContentIndexSoftLimitBytes());
}

function ensureUnderHardLimit(db: DatabaseSync, term: string, source: ContentIndexSource) {
  if (getContentIndexDiskUsageBytes() <= getContentIndexHardLimitBytes()) {
    return;
  }

  pruneColdAutoIndexes(db, getContentIndexSoftLimitBytes());
  if (getContentIndexDiskUsageBytes() <= getContentIndexHardLimitBytes()) {
    return;
  }

  deleteContentIndexTermRows(db, term);
  vacuumContentIndex(db);
  if (source === "manual") {
    throw new Error("索引库已超过硬上限，手动索引未写入。请删除旧索引或调大硬上限后重试。");
  }
}

export function getContentIndexStorageSummary(db = getContentIndexDb()): ContentIndexStorageSummary {
  const counts = db
    .prepare(
      `
      SELECT
        COUNT(*) AS termCount,
        SUM(CASE WHEN source = 'auto' THEN 1 ELSE 0 END) AS autoTermCount,
        SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manualTermCount
      FROM content_search_term_stats
    `,
    )
    .get() as { termCount: number; autoTermCount: number | null; manualTermCount: number | null };

  return {
    databasePath: getContentIndexDatabasePath(),
    databaseBytes: getContentIndexDiskUsageBytes(),
    softLimitBytes: getContentIndexSoftLimitBytes(),
    hardLimitBytes: getContentIndexHardLimitBytes(),
    termCount: counts.termCount || 0,
    autoTermCount: counts.autoTermCount || 0,
    manualTermCount: counts.manualTermCount || 0,
  };
}

export function markContentIndexTermUsed(db: DatabaseSync, term: string) {
  db.prepare(
    `
    UPDATE content_search_term_stats
    SET hit_count = hit_count + 1,
      last_used_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE term = ?
  `,
  ).run(term);
}

export function getIndexedNovelIds(db: DatabaseSync, term: string): number[] {
  const normalizedTerm = normalizeContentIndexTerm(term);
  if (!normalizedTerm) {
    return [];
  }

  return (
    db
      .prepare(
        `
        SELECT novel_id AS novelId
        FROM content_search_terms
        WHERE term = ?
        ORDER BY novel_id ASC
      `,
      )
      .all(normalizedTerm) as Array<{ novelId: number }>
  ).map((row) => row.novelId);
}

export function findIndexedContentCandidateNovelIds(db: DatabaseSync, requiredTerms: string[]): IndexedContentCandidatePlan | null {
  const seenTerms = new Set<string>();
  const entries: Array<{ requestedTerm: string; term: string; novelIds: number[] }> = [];

  for (const requiredTerm of normalizeContentIndexTerms(requiredTerms)) {
    const indexedTerm = findBestIndexedContentTerm(db, requiredTerm);
    if (!indexedTerm || seenTerms.has(indexedTerm.term)) {
      continue;
    }

    seenTerms.add(indexedTerm.term);
    entries.push({
      requestedTerm: requiredTerm,
      term: indexedTerm.term,
      novelIds: getIndexedNovelIds(db, indexedTerm.term),
    });
  }

  if (!entries.length) {
    return null;
  }

  entries.sort((left, right) => left.novelIds.length - right.novelIds.length);
  const intersection = new Set(entries[0].novelIds);
  for (const entry of entries.slice(1)) {
    const current = new Set(entry.novelIds);
    for (const novelId of Array.from(intersection)) {
      if (!current.has(novelId)) {
        intersection.delete(novelId);
      }
    }
  }

  return {
    terms: entries.map((entry) => entry.term),
    requestedTerms: entries.map((entry) => entry.requestedTerm),
    novelIds: Array.from(intersection).sort((left, right) => left - right),
  };
}

export function cleanupInterruptedContentIndexJobs(db = getContentIndexDb()) {
  const interrupted = db
    .prepare(
      `
      SELECT id
      FROM content_index_jobs
      WHERE status = 'running'
        AND datetime(heartbeat_at) < datetime('now', '-10 minutes')
    `,
    )
    .all() as Array<{ id: string }>;

  for (const job of interrupted) {
    db.prepare("DELETE FROM content_index_staging_terms WHERE job_id = ?").run(job.id);
    db.prepare("UPDATE content_index_jobs SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
  }
}

export function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE name = ? LIMIT 1").get(tableName) as
    | { found: number }
    | undefined;
  return Boolean(row);
}

export function deleteLegacyFtsRows(db: DatabaseSync, novelId: number) {
  if (tableExists(db, "novel_segments_fts")) {
    db.prepare("DELETE FROM novel_segments_fts WHERE novel_id = ?").run(novelId);
  }
}

export function deleteContentIndexRowsForNovel(db: DatabaseSync, novelId: number) {
  if (tableExists(db, "content_search_terms")) {
    db.prepare("DELETE FROM content_search_terms WHERE novel_id = ?").run(novelId);
  }

  const indexDb = getContentIndexDb();
  const terms = (
    indexDb.prepare("SELECT DISTINCT term FROM content_search_terms WHERE novel_id = ?").all(novelId) as Array<{ term: string }>
  ).map((row) => row.term);

  indexDb.prepare("DELETE FROM content_search_terms WHERE novel_id = ?").run(novelId);
  indexDb.prepare("DELETE FROM content_index_novel_state WHERE novel_id = ?").run(novelId);
  refreshNovelCountsForTerms(indexDb, terms);
}

export function deleteIndexedContentForNovel(db: DatabaseSync, novelId: number) {
  deleteLegacyFtsRows(db, novelId);
  deleteContentIndexRowsForNovel(db, novelId);
  if (tableExists(db, "novel_segments")) {
    db.prepare("DELETE FROM novel_segments WHERE novel_id = ?").run(novelId);
  }
  db.prepare("DELETE FROM search_index_state WHERE novel_id = ?").run(novelId);
}

export function refreshContentIndexTermStats(
  db: DatabaseSync,
  terms = normalizeContentIndexTerms(),
  segmentCounts = new Map<string, number>(),
  source: ContentIndexSource = "manual",
): ContentIndexTermStatus[] {
  const countTerm = db.prepare("SELECT COUNT(*) AS count FROM content_search_terms WHERE term = ?");
  const upsertStats = db.prepare(`
    INSERT INTO content_search_term_stats (term, segment_count, novel_count, status, source, created_at, updated_at)
    VALUES (@term, @segmentCount, @novelCount, @status, @source, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(term) DO UPDATE SET
      segment_count = excluded.segment_count,
      novel_count = excluded.novel_count,
      status = excluded.status,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `);

  return terms.map((term) => {
    const row = countTerm.get(term) as { count: number };
    const segmentCount = segmentCounts.get(term) ?? row.count;
    upsertStats.run({ term, segmentCount, novelCount: row.count, status: "indexed", source });
    return { term, segmentCount, status: "indexed", source };
  });
}

export function getContentIndexTermStatus(db: DatabaseSync, term: string): ContentIndexTermStatus | null {
  const normalizedTerm = normalizeContentIndexTerm(term);
  if (!normalizedTerm) {
    return null;
  }

  const row = db
    .prepare(
      `
      SELECT term, segment_count AS segmentCount, status, source
      FROM content_search_term_stats
      WHERE term = ?
      LIMIT 1
    `,
    )
    .get(normalizedTerm) as ContentIndexTermStatus | undefined;

  return row || null;
}

export function listContentIndexTerms(db: DatabaseSync): ContentIndexSummary[] {
  const rows = db
    .prepare(
      `
      SELECT
        s.term,
        s.segment_count AS segmentCount,
        s.status,
        s.source,
        s.hit_count AS hitCount,
        s.last_used_at AS lastUsedAt,
        s.updated_at AS updatedAt,
        s.novel_count AS novelCount
      FROM content_search_term_stats s
      ORDER BY s.updated_at DESC, s.term ASC
    `,
    )
    .all() as ContentIndexSummary[];

  return rows.map((row) => ({
    term: row.term,
    segmentCount: row.segmentCount,
    status: row.status,
    source: row.source,
    hitCount: row.hitCount,
    lastUsedAt: row.lastUsedAt,
    updatedAt: row.updatedAt,
    novelCount: row.novelCount,
  }));
}

export function deleteContentIndexTerm(db: DatabaseSync, term: string): string {
  const normalizedTerm = normalizeContentIndexTerm(term);
  if (!normalizedTerm) {
    return "";
  }

  deleteContentIndexTermRows(db, normalizedTerm);
  return normalizedTerm;
}

export function deleteContentIndexTerms(db: DatabaseSync, terms: string[]): string[] {
  const normalizedTerms = normalizeContentIndexTerms(terms);
  for (const term of normalizedTerms) {
    deleteContentIndexTermRows(db, term);
  }
  if (normalizedTerms.length) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }
  return normalizedTerms;
}

export function saveContentIndexTerm(
  db: DatabaseSync,
  term: string,
  novelIds: Iterable<number>,
  segmentCount: number,
  options: ContentIndexLimitOptions = {},
): ContentIndexTermStatus {
  const normalizedTerm = normalizeContentIndexTerm(term);
  if (!normalizedTerm) {
    throw new Error("索引关键词不能为空");
  }

  const maxSegments = options.maxSegments === undefined ? getContentIndexMaxSegments() : options.maxSegments;
  const source = options.source || "auto";
  const status: ContentIndexTermStatus["status"] = maxSegments !== null && segmentCount > maxSegments ? "skipped" : "indexed";
  const uniqueNovelIds = Array.from(new Set(novelIds)).filter((id) => Number.isInteger(id) && id > 0);
  const insertTerm = db.prepare("INSERT OR IGNORE INTO content_search_terms (term, novel_id) VALUES (?, ?)");

  if (options.enforceBudget !== false && source === "auto") {
    enforceContentIndexBudget(db);
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM content_search_terms WHERE term = ?").run(normalizedTerm);
    if (status === "indexed") {
      for (const novelId of uniqueNovelIds) {
        insertTerm.run(normalizedTerm, novelId);
      }
    }
    db.prepare(
      `
      INSERT INTO content_search_term_stats (term, segment_count, novel_count, status, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(term) DO UPDATE SET
        segment_count = excluded.segment_count,
        novel_count = excluded.novel_count,
        status = excluded.status,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `,
    ).run(normalizedTerm, segmentCount, status === "indexed" ? uniqueNovelIds.length : 0, status, source);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  if (options.enforceBudget !== false) {
    ensureUnderHardLimit(db, normalizedTerm, source);
  }

  return { term: normalizedTerm, segmentCount, status, source };
}

export async function buildContentIndexTerm(
  db: DatabaseSync,
  term: string,
  onProgress?: (progress: ContentIndexBuildProgress) => void,
): Promise<ContentIndexTermStatus> {
  const result = await buildContentIndexTerms(db, [term], onProgress, { source: "manual", maxSegments: null });
  if (!result[0]) {
    throw new Error("索引关键词不能为空");
  }
  return result[0];
}

export async function buildContentIndexTerms(
  mainDb: DatabaseSync,
  terms: string[],
  onProgress?: (progress: ContentIndexBuildProgress) => void,
  options: ContentIndexBuildOptions = {},
): Promise<ContentIndexTermStatus[]> {
  const normalizedTerms = normalizeContentIndexTerms(terms);
  if (!normalizedTerms.length) {
    throw new Error("索引关键词不能为空");
  }

  const source = options.source || "manual";
  const maxSegments = options.maxSegments === undefined ? null : options.maxSegments;
  const throwIfCancelled = () => {
    if (options.isCancelled?.()) {
      throw new ContentIndexCancelledError();
    }
  };
  const indexDb = getContentIndexDb();
  cleanupInterruptedContentIndexJobs(indexDb);

  const jobId = crypto.randomUUID();
  const segmentCounts = new Map<string, number>();
  const matchedNovelCounts = new Map<string, Set<number>>();
  const skippedTerms = new Set<string>();
  const activeTerms = new Set(normalizedTerms);
  const insertStaging = indexDb.prepare("INSERT OR IGNORE INTO content_index_staging_terms (job_id, term, novel_id) VALUES (?, ?, ?)");
  const novels = mainDb
    .prepare(
      `
      SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
      FROM novels
      ORDER BY id ASC
    `,
    )
    .all() as Novel[];

  indexDb
    .prepare(
      `
      INSERT INTO content_index_jobs (id, terms, source, status, total_books, scanned_books, heartbeat_at, updated_at)
      VALUES (?, ?, ?, 'running', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    )
    .run(jobId, JSON.stringify(normalizedTerms), source, novels.length);
  indexDb.prepare("DELETE FROM content_index_staging_terms WHERE job_id = ?").run(jobId);

  onProgress?.({
    totalBooks: novels.length,
    scannedBooks: 0,
    matchedBooks: 0,
    segmentCount: 0,
    completedTerms: 0,
    totalTerms: normalizedTerms.length,
  });

  try {
    throwIfCancelled();
    for (let index = 0; index < novels.length; index += 1) {
      throwIfCancelled();
      const novel = novels[index];
      const segments = createNovelSegments(await readNovelContent(novel));

      indexDb.exec("BEGIN");
      try {
        for (const segment of segments) {
          throwIfCancelled();
          const normalizedContent = normalizeSearchText(segment.content);
          for (const term of Array.from(activeTerms)) {
            if (normalizedContent.includes(term)) {
              const nextCount = (segmentCounts.get(term) || 0) + 1;
              segmentCounts.set(term, nextCount);
              if (maxSegments !== null && nextCount > maxSegments) {
                skippedTerms.add(term);
                activeTerms.delete(term);
                matchedNovelCounts.delete(term);
                indexDb.prepare("DELETE FROM content_index_staging_terms WHERE job_id = ? AND term = ?").run(jobId, term);
              } else {
                insertStaging.run(jobId, term, novel.id);
                const novelSet = matchedNovelCounts.get(term) || new Set<number>();
                novelSet.add(novel.id);
                matchedNovelCounts.set(term, novelSet);
              }
            }
          }
        }
        indexDb.exec("COMMIT");
      } catch (error) {
        indexDb.exec("ROLLBACK");
        throw error;
      }

      const totalSegments = Array.from(segmentCounts.values()).reduce((total, count) => total + count, 0);
      const matchedBooks = new Set(Array.from(matchedNovelCounts.values()).flatMap((ids) => Array.from(ids))).size;
      indexDb
        .prepare(
          `
          UPDATE content_index_jobs
          SET scanned_books = ?, matched_books = ?, segment_count = ?, heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        )
        .run(index + 1, matchedBooks, totalSegments, jobId);
      onProgress?.({
        totalBooks: novels.length,
        scannedBooks: index + 1,
        matchedBooks,
        segmentCount: totalSegments,
        completedTerms: skippedTerms.size,
        totalTerms: normalizedTerms.length,
      });
    }

    throwIfCancelled();
    const results: ContentIndexTermStatus[] = [];
    indexDb.exec("BEGIN");
    try {
      for (const term of normalizedTerms) {
        const segmentCount = segmentCounts.get(term) || 0;
        const status: ContentIndexTermStatus["status"] = skippedTerms.has(term) ? "skipped" : "indexed";
        const novelCountRow = indexDb
          .prepare("SELECT COUNT(*) AS count FROM content_index_staging_terms WHERE job_id = ? AND term = ?")
          .get(jobId, term) as { count: number };

        indexDb.prepare("DELETE FROM content_search_terms WHERE term = ?").run(term);
        if (status === "indexed") {
          indexDb
            .prepare(
              `
              INSERT OR IGNORE INTO content_search_terms (term, novel_id)
              SELECT term, novel_id
              FROM content_index_staging_terms
              WHERE job_id = ? AND term = ?
            `,
            )
            .run(jobId, term);
        }
        indexDb
          .prepare(
            `
            INSERT INTO content_search_term_stats (term, segment_count, novel_count, status, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(term) DO UPDATE SET
              segment_count = excluded.segment_count,
              novel_count = excluded.novel_count,
              status = excluded.status,
              source = excluded.source,
              updated_at = CURRENT_TIMESTAMP
          `,
          )
          .run(term, segmentCount, status === "indexed" ? novelCountRow.count : 0, status, source);
        results.push({ term, segmentCount, status, source });
      }

      indexDb.prepare("DELETE FROM content_index_staging_terms WHERE job_id = ?").run(jobId);
      indexDb
        .prepare("UPDATE content_index_jobs SET status = 'done', updated_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(jobId);
      indexDb.exec("COMMIT");
    } catch (error) {
      indexDb.exec("ROLLBACK");
      throw error;
    }

    if (source === "auto") {
      enforceContentIndexBudget(indexDb);
    }
    if (getContentIndexDiskUsageBytes() > getContentIndexHardLimitBytes()) {
      if (source === "manual") {
        for (const term of normalizedTerms) {
          deleteContentIndexTermRows(indexDb, term);
        }
        vacuumContentIndex(indexDb);
        throw new Error("索引库已超过硬上限，批量手动索引已撤销。请删除旧索引或调大硬上限后重试。");
      }
      pruneColdAutoIndexes(indexDb, getContentIndexSoftLimitBytes());
    }

    return results;
  } catch (error) {
    indexDb.prepare("DELETE FROM content_index_staging_terms WHERE job_id = ?").run(jobId);
    indexDb
      .prepare("UPDATE content_index_jobs SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(error instanceof ContentIndexCancelledError ? "cancelled" : "failed", error instanceof Error ? error.message : String(error), jobId);
    throw error;
  }
}

export function findBestIndexedContentTerm(db: DatabaseSync, anchorTerm: string): ContentIndexTermStatus | null {
  const row = db
    .prepare(
      `
      SELECT term, segment_count AS segmentCount, status, source
      FROM content_search_term_stats
      WHERE status = 'indexed'
        AND segment_count > 0
        AND instr(?, term) > 0
      ORDER BY segment_count ASC, length(term) DESC
      LIMIT 1
    `,
    )
    .get(anchorTerm) as ContentIndexTermStatus | undefined;

  return row || null;
}
