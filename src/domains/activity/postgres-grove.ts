import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";

export type PostgresGroveKind = "novel" | "original" | "video" | "audio";
export type PostgresGroveStage = "seed" | "sprout" | "tree";
export type PostgresGroveState = Readonly<{ planted: boolean; visitCount: number; stage: PostgresGroveStage }>;

type GroveBase = { id: number; title: string; visitCount: number; stage: PostgresGroveStage; plantedAt: string };
export type PostgresGroveItem =
  | (GroveBase & { kind: "novel"; storageMode: "single" | "chapters"; chapterCount: number; wordCount: number })
  | (GroveBase & { kind: "original"; slug: string; authorId: number; authorName: string; authorAvatarPath: string | null; wordCount: number; unlockSodaPrice: number })
  | (GroveBase & { kind: "video" | "audio"; fileName: string; artist: string; durationSeconds: number | null });

export type PostgresGrovePage = Readonly<{
  items: PostgresGroveItem[];
  stats: Readonly<{ all: number; seed: number; sprout: number; tree: number }>;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

type TransactionRunner = <T>(operation: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
type StateRow = QueryResultRow & { visit_count: string | number | null };
type GroveRow = QueryResultRow & {
  all_count: string | number;
  seed_count: string | number;
  sprout_count: string | number;
  tree_count: string | number;
  total_items: string | number;
  total_pages: string | number;
  page: string | number;
  kind: PostgresGroveKind | null;
  item_id: string | number | null;
  title: string | null;
  visit_count: string | number | null;
  planted_at: Date | string | null;
  storage_mode: "single" | "chapters" | null;
  chapter_count: number | null;
  word_count: string | number | null;
  slug: string | null;
  author_id: string | number | null;
  author_name: string | null;
  author_avatar_path: string | null;
  unlock_soda_price: string | number | null;
  file_name: string | null;
  artist: string | null;
  duration_seconds: string | number | null;
};

function positiveId(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function count(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null): string {
  const parsed = value instanceof Date ? value : new Date(value ?? "");
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL grove timestamp");
  return parsed.toISOString();
}

function groveKind(value: unknown): PostgresGroveKind {
  if (value !== "novel" && value !== "original" && value !== "video" && value !== "audio") {
    throw new TypeError("Invalid PostgreSQL grove kind");
  }
  return value;
}

export function normalizePostgresGroveStage(value: string | undefined): PostgresGroveStage | null {
  return value === "seed" || value === "sprout" || value === "tree" ? value : null;
}

export function postgresGroveStageForVisitCount(value: number): PostgresGroveStage {
  const visits = Number.isSafeInteger(value) && value > 0 ? value : 0;
  return visits >= 10 ? "tree" : visits >= 3 ? "sprout" : "seed";
}

function state(row: StateRow | undefined): PostgresGroveState {
  const planted = row?.visit_count !== null && row?.visit_count !== undefined;
  const visitCount = count(row?.visit_count ?? 0, "grove visit count");
  return { planted, visitCount, stage: postgresGroveStageForVisitCount(visitCount) };
}

async function readState(
  executor: SqlExecutor,
  userIdValue: number,
  itemIdValue: number,
  kind: "original" | "media",
): Promise<PostgresGroveState> {
  const table = kind === "original" ? "user_original_grove" : "user_media_grove";
  const column = kind === "original" ? "article_id" : "media_id";
  const result = await executor.query<StateRow>({
    text: `SELECT visit_count FROM ${table} WHERE user_id = $1 AND ${column} = $2`,
    values: [positiveId(userIdValue, "user id"), positiveId(itemIdValue, "grove item id")],
  });
  return state(result.rows[0]);
}

export function getPostgresOriginalGroveState(executor: SqlExecutor, userId: number, articleId: number) {
  return readState(executor, userId, articleId, "original");
}

export function getPostgresMediaGroveState(executor: SqlExecutor, userId: number, mediaId: number) {
  return readState(executor, userId, mediaId, "media");
}

async function toggle(
  userIdValue: number,
  itemIdValue: number,
  kind: "original" | "media",
  transaction: TransactionRunner,
): Promise<{ ok: boolean } & PostgresGroveState> {
  const userId = positiveId(userIdValue, "user id");
  const itemId = positiveId(itemIdValue, `${kind} id`);
  const table = kind === "original" ? "user_original_grove" : "user_media_grove";
  const column = kind === "original" ? "article_id" : "media_id";
  const source = kind === "original" ? "original_articles" : "media_assets";
  const condition = kind === "original" ? "AND item.status = 'published'" : "AND item.kind IN ('video', 'audio')";
  return transaction(async (tx) => {
    await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", values: [`${kind}-grove:${userId}:${itemId}`] });
    const removed = await tx.query({ text: `DELETE FROM ${table} WHERE user_id = $1 AND ${column} = $2`, values: [userId, itemId] });
    if (removed.rowCount) return { ok: true, planted: false, visitCount: 0, stage: "seed" };
    const added = await tx.query<StateRow>({
      text: `INSERT INTO ${table} (user_id, ${column}, visit_count)
        SELECT $1, item.id, 0 FROM ${source} item
        JOIN users account ON account.id = $1 AND account.status = 'active' AND account.deleted_at IS NULL
        WHERE item.id = $2 ${condition}
        ON CONFLICT (user_id, ${column}) DO NOTHING RETURNING visit_count`,
      values: [userId, itemId],
    });
    return added.rows[0] ? { ok: true, ...state(added.rows[0]) } : { ok: false, planted: false, visitCount: 0, stage: "seed" };
  });
}

export function togglePostgresOriginalGrove(userId: number, articleId: number, transaction: TransactionRunner = (operation) => withTransaction(operation)) {
  return toggle(userId, articleId, "original", transaction);
}

export function togglePostgresMediaGrove(userId: number, mediaId: number, transaction: TransactionRunner = (operation) => withTransaction(operation)) {
  return toggle(userId, mediaId, "media", transaction);
}


export async function listPostgresGrovePage(
  executor: SqlExecutor,
  userIdValue: number,
  options: { stage?: PostgresGroveStage | null; allowedKinds?: readonly PostgresGroveKind[]; page?: number; pageSize?: number } = {},
): Promise<PostgresGrovePage> {
  const userId = positiveId(userIdValue, "user id");
  const allowedKinds = [...new Set(options.allowedKinds ?? ["novel", "original", "video", "audio"])].map(groveKind);
  const stage = options.stage ?? null;
  if (stage !== null && stage !== "seed" && stage !== "sprout" && stage !== "tree") throw new TypeError("Invalid PostgreSQL grove stage");
  const requestedPage = Number.isSafeInteger(options.page) && Number(options.page) > 0 ? Number(options.page) : 1;
  const pageSize = Number.isSafeInteger(options.pageSize) ? Math.min(Math.max(Number(options.pageSize), 1), 100) : 24;
  if (!allowedKinds.length) return { items: [], stats: { all: 0, seed: 0, sprout: 0, tree: 0 }, page: 1, pageSize, totalItems: 0, totalPages: 1 };
  const result = await executor.query<GroveRow>({
    text: `WITH grove AS MATERIALIZED (
        SELECT 'novel'::text AS kind, relation.novel_id AS item_id, novel.title,
               relation.visit_count, relation.created_at AS planted_at,
               novel.storage_mode, novel.chapter_count, novel.word_count,
               NULL::text AS slug, NULL::bigint AS author_id, NULL::text AS author_name,
               NULL::text AS author_avatar_path, NULL::bigint AS unlock_soda_price,
               NULL::text AS file_name, NULL::text AS artist, NULL::double precision AS duration_seconds
        FROM user_novel_grove relation JOIN novels novel ON novel.id = relation.novel_id
        WHERE relation.user_id = $1
        UNION ALL
        SELECT 'original', relation.article_id, article.title, relation.visit_count, relation.created_at,
               NULL, NULL, article.word_count, article.slug, article.author_id, account.display_name,
               account.avatar_path, article.unlock_soda_price, NULL, NULL, NULL
        FROM user_original_grove relation
        JOIN original_articles article ON article.id = relation.article_id AND article.status = 'published'
        JOIN users account ON account.id = article.author_id
        WHERE relation.user_id = $1
        UNION ALL
        SELECT media.kind, relation.media_id, media.title, relation.visit_count, relation.created_at,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
               media.file_name, media.artist, media.duration_seconds
        FROM user_media_grove relation JOIN media_assets media ON media.id = relation.media_id
        WHERE relation.user_id = $1 AND media.kind IN ('video', 'audio')
      ), scoped AS MATERIALIZED (
        SELECT * FROM grove WHERE kind = ANY($2::text[])
      ), visible AS MATERIALIZED (
        SELECT * FROM scoped WHERE $3::text IS NULL
          OR ($3 = 'seed' AND visit_count < 3)
          OR ($3 = 'sprout' AND visit_count BETWEEN 3 AND 9)
          OR ($3 = 'tree' AND visit_count >= 10)
      ), aggregate AS (
        SELECT COUNT(*)::bigint AS all_count,
               COUNT(*) FILTER (WHERE visit_count < 3)::bigint AS seed_count,
               COUNT(*) FILTER (WHERE visit_count BETWEEN 3 AND 9)::bigint AS sprout_count,
               COUNT(*) FILTER (WHERE visit_count >= 10)::bigint AS tree_count
        FROM scoped
      ), page_info AS (
        SELECT COUNT(*)::bigint AS total_items,
               GREATEST(CEIL(COUNT(*)::numeric / $5::integer), 1)::bigint AS total_pages
        FROM visible
      ), requested AS (
        SELECT aggregate.*, page_info.*,
               LEAST(GREATEST($4::bigint, 1), page_info.total_pages) AS page
        FROM aggregate CROSS JOIN page_info
      )
      SELECT requested.*, item.* FROM requested
      LEFT JOIN LATERAL (
        SELECT * FROM visible
        ORDER BY planted_at DESC, kind ASC, item_id DESC
        LIMIT $5::integer OFFSET ((requested.page - 1) * $5::integer)
      ) item ON TRUE`,
    values: [userId, allowedKinds, stage, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL grove page metadata is missing");
  const items = result.rows.flatMap((row): PostgresGroveItem[] => {
    if (row.item_id === null || row.kind === null) return [];
    const kind = groveKind(row.kind);
    const visitCount = count(row.visit_count, "grove visit count");
    const base = { id: positiveId(row.item_id, "grove item id"), title: row.title ?? "", visitCount, stage: postgresGroveStageForVisitCount(visitCount), plantedAt: timestamp(row.planted_at) };
    if (kind === "novel") return [{ ...base, kind, storageMode: row.storage_mode ?? "single", chapterCount: count(row.chapter_count, "grove chapter count"), wordCount: count(row.word_count, "grove novel word count") }];
    if (kind === "original") return [{ ...base, kind, slug: row.slug ?? "", authorId: positiveId(row.author_id, "grove author id"), authorName: row.author_name ?? "", authorAvatarPath: row.author_avatar_path, wordCount: count(row.word_count, "grove original word count"), unlockSodaPrice: count(row.unlock_soda_price, "grove original price") }];
    const duration = row.duration_seconds === null ? null : Number(row.duration_seconds);
    if (duration !== null && (!Number.isFinite(duration) || duration < 0)) throw new Error("Invalid PostgreSQL grove media duration");
    return [{ ...base, kind, fileName: row.file_name ?? "", artist: row.artist ?? "", durationSeconds: duration }];
  });
  return {
    items,
    stats: { all: count(first.all_count, "grove total"), seed: count(first.seed_count, "grove seeds"), sprout: count(first.sprout_count, "grove sprouts"), tree: count(first.tree_count, "grove trees") },
    page: count(first.page, "grove page"),
    pageSize,
    totalItems: count(first.total_items, "grove visible total"),
    totalPages: count(first.total_pages, "grove total pages"),
  };
}
