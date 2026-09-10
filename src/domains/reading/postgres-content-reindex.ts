import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { decodeNovelBuffer } from "@/lib/text";
import { CONTENT_NORMALIZATION_VERSION } from "./content-text";
import { publishPostgresContent, type ContentBuild } from "./postgres-content";

export type PostgresContentOwnerKind = "novel" | "chapter";

export type PostgresContentReindexCandidate = {
  ownerId: number;
  novelId: number;
  chapterId: number | null;
  title: string;
  relativePath: string;
  sourceContentVersion: string;
  expectedPublishedVersion: string | null;
};

export type PostgresContentCandidateOptions = {
  cursor?: number;
  limit?: number;
  novelId?: number;
  sourceId?: number;
  force?: boolean;
};

type RawCandidate = QueryResultRow & {
  owner_id: number;
  novel_id: number;
  chapter_id: number | null;
  title: string;
  relative_path: string;
  content_hash: string;
  published_content_version: string | null;
};

function positiveInt32(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new Error(`Invalid ${label}`);
  }
  return Number(value);
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 25;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error("Content candidate limit must be an integer from 1 to 100");
  }
  return value;
}

function candidateFromRow(row: RawCandidate): PostgresContentReindexCandidate {
  const sourceContentVersion = row.content_hash.toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{64}$/u.test(sourceContentVersion)) {
    throw new Error("PostgreSQL content source hash is invalid");
  }
  if (!row.relative_path || row.relative_path.length > 4_096 || row.relative_path.includes("\0")) {
    throw new Error("PostgreSQL content source path is invalid");
  }
  return {
    ownerId: positiveInt32(row.owner_id, "content owner id"),
    novelId: positiveInt32(row.novel_id, "content novel id"),
    chapterId: row.chapter_id === null ? null : positiveInt32(row.chapter_id, "content chapter id"),
    title: row.title,
    relativePath: row.relative_path,
    sourceContentVersion,
    expectedPublishedVersion: row.published_content_version,
  };
}

type CandidateQueryParts = {
  values: unknown[];
  owner: "n" | "c";
  select: string;
  from: string;
  where: string;
  parameter(value: unknown): string;
};

function contentCandidateQueryParts(
  kind: PostgresContentOwnerKind,
  options: PostgresContentCandidateOptions = {},
): CandidateQueryParts {
  if (kind !== "novel" && kind !== "chapter") throw new Error("Invalid PostgreSQL content owner kind");
  const values: unknown[] = [];
  const parameter = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const owner = kind === "novel" ? "n" : "c";
  const cursor = options.cursor === undefined ? 0 : options.cursor;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 2_147_483_647) {
    throw new Error("Invalid content candidate cursor");
  }
  const filters = [`${owner}.id > ${parameter(cursor)}`, `${owner}.content_hash IS NOT NULL`, `${owner}.content_hash <> ''`];
  filters.push(kind === "novel" ? "n.storage_mode = 'single'" : "n.storage_mode = 'chapters'");
  if (options.novelId !== undefined) {
    filters.push(`n.id = ${parameter(positiveInt32(options.novelId, "content candidate novel id"))}`);
  }
  if (options.sourceId !== undefined) {
    filters.push(`n.source_id = ${parameter(positiveInt32(options.sourceId, "content candidate source id"))}`);
  }
  if (!options.force) {
    filters.push(`(
      d.id IS NULL OR d.state <> 'ready' OR d.active_generation <= 0
      OR d.normalization_version <> ${parameter(CONTENT_NORMALIZATION_VERSION)}
      OR d.active_content_version IS DISTINCT FROM ${owner}.published_content_version
      OR g.document_id IS NULL OR g.state <> 'published'
      OR g.source_content_version IS DISTINCT FROM ${owner}.content_hash
    )`);
  }
  const select = kind === "novel"
    ? `n.id AS owner_id, n.id AS novel_id, NULL::integer AS chapter_id,
       n.title, n.relative_path, n.content_hash, n.published_content_version`
    : `c.id AS owner_id, n.id AS novel_id, c.id AS chapter_id,
       COALESCE(NULLIF(c.title_override, ''), c.title) AS title,
       c.relative_path, c.content_hash, c.published_content_version`;
  const documentJoin = kind === "novel"
    ? "d.novel_id = n.id AND d.chapter_id IS NULL"
    : "d.novel_id = n.id AND d.chapter_id = c.id";
  return {
    values,
    owner,
    select,
    from: `FROM novels n
      ${kind === "chapter" ? "JOIN novel_chapters c ON c.novel_id = n.id" : ""}
      LEFT JOIN novel_documents d ON ${documentJoin}
      LEFT JOIN novel_content_generations g
        ON g.document_id = d.id AND g.generation = d.active_generation`,
    where: filters.join(" AND "),
    parameter,
  };
}

export function buildPostgresContentCandidateQuery(
  kind: PostgresContentOwnerKind,
  options: PostgresContentCandidateOptions = {},
): SqlQuery {
  const query = contentCandidateQueryParts(kind, options);
  return {
    text: `
      SELECT ${query.select}
      ${query.from}
      WHERE ${query.where}
      ORDER BY ${query.owner}.id ASC
      LIMIT ${query.parameter(boundedLimit(options.limit))}`,
    values: query.values,
  };
}

export async function countPostgresContentReindexCandidates(
  executor: SqlExecutor,
  kind: PostgresContentOwnerKind,
  options: Omit<PostgresContentCandidateOptions, "cursor" | "limit"> = {},
): Promise<number> {
  const query = contentCandidateQueryParts(kind, options);
  const result = await executor.query<QueryResultRow & { count: string | number }>({
    text: `SELECT COUNT(*) AS count ${query.from} WHERE ${query.where}`,
    values: query.values,
  });
  const count = Number(result.rows[0]?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("PostgreSQL returned an invalid content candidate count");
  return count;
}

export async function listPostgresContentReindexCandidates(
  executor: SqlExecutor,
  kind: PostgresContentOwnerKind,
  options: PostgresContentCandidateOptions = {},
): Promise<PostgresContentReindexCandidate[]> {
  const result = await executor.query<RawCandidate>(buildPostgresContentCandidateQuery(kind, options));
  return result.rows.map(candidateFromRow);
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function readVerifiedPostgresContentSource(
  libraryRoot: string,
  candidate: Pick<PostgresContentReindexCandidate, "relativePath" | "sourceContentVersion">,
): Promise<{ text: string; bytes: number }> {
  const realRoot = await fs.realpath(path.resolve(libraryRoot));
  const requestedPath = path.resolve(realRoot, candidate.relativePath);
  if (!isContainedPath(realRoot, requestedPath)) throw new Error("Content source path leaves the novel library");
  const realPath = await fs.realpath(requestedPath);
  if (!isContainedPath(realRoot, realPath)) throw new Error("Content source symlink leaves the novel library");
  const handle = await fs.open(realPath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Content source is not a regular file");
    const buffer = await handle.readFile();
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== candidate.sourceContentVersion) {
      throw new Error("Content source changed after its PostgreSQL catalog record was written");
    }
    const text = decodeNovelBuffer(buffer);
    if (!text.trim()) throw new Error("Content source is empty");
    return { text, bytes: buffer.length };
  } finally {
    await handle.close();
  }
}

export async function reindexPostgresContentCandidate(
  candidate: PostgresContentReindexCandidate,
  libraryRoot: string,
  signal?: AbortSignal,
): Promise<{ build: ContentBuild; bytes: number }> {
  signal?.throwIfAborted();
  const source = await readVerifiedPostgresContentSource(libraryRoot, candidate);
  signal?.throwIfAborted();
  const build = await publishPostgresContent({
    novelId: candidate.novelId,
    chapterId: candidate.chapterId,
    sourceContentVersion: candidate.sourceContentVersion,
    expectedPublishedVersion: candidate.expectedPublishedVersion,
    text: source.text,
    signal,
  });
  return { build, bytes: source.bytes };
}
