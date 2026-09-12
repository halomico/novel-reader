import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { postgresSiteDateKey } from "@/domains/identity/postgres-user-economy";
import type { PostgresUserProfile } from "@/domains/identity/postgres-users";
import { canConsumeOriginalChannel, getOriginalPublishingSettings } from "@/lib/config";
import {
  countOriginalWords,
  MAX_ORIGINAL_COMMENT_LENGTH,
} from "@/lib/original-constants";
import {
  OriginalInputError,
  normalizeOriginalSlug,
  type OriginalAccess,
  type OriginalAccessMode,
  type OriginalAdjacentArticles,
  type OriginalArticle,
  type OriginalArticleList,
  type OriginalArticleStatus,
  type OriginalBlockedAuthor,
  type OriginalComment,
  type OriginalCommentActivityList,
  type OriginalCommentMutationResult,
  type OriginalCommentPage,
  type OriginalCommentQuota,
  type OriginalCommentSubmitResult,
  type OriginalCommentUpdateResult,
  type OriginalSort,
  type OriginalSortOrder,
  type OriginalTag,
  normalizeOriginalSortOrder,
} from "./original-model";

export {
  OriginalInputError,
  defaultOriginalSortOrder,
  normalizeOriginalSort,
  normalizeOriginalSortOrder,
} from "./original-model";
export type {
  OriginalAccess,
  OriginalAccessMode,
  OriginalAdjacentArticles,
  OriginalArticle,
  OriginalArticleList,
  OriginalArticleStatus,
  OriginalBlockedAuthor,
  OriginalComment,
  OriginalCommentActivity,
  OriginalCommentActivityList,
  OriginalCommentMutationResult,
  OriginalCommentPage,
  OriginalCommentQuota,
  OriginalCommentSubmitResult,
  OriginalCommentUpdateResult,
  OriginalSort,
  OriginalSortOrder,
  OriginalTag,
} from "./original-model";

type ArticleRow = QueryResultRow & {
  id: string | number | null;
  slug: string | null;
  author_id: string | number | null;
  author_name: string | null;
  author_avatar_path: string | null;
  title: string | null;
  excerpt: string | null;
  body_markdown: string | null;
  paid_body_markdown: string | null;
  word_count: string | number | null;
  access_mode: string | null;
  unlock_soda_price: string | number | null;
  status: string | null;
  is_pinned: boolean | null;
  pinned_at: Date | string | null;
  view_count: string | number | null;
  comment_count: string | number | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  published_at: Date | string | null;
  tags: unknown;
};

type CommentRow = QueryResultRow & {
  id: string | number | null;
  article_id: string | number | null;
  author_id: string | number | null;
  author_name: string | null;
  author_avatar_path: string | null;
  body_markdown: string | null;
  status: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type PageMetadata = QueryResultRow & {
  page: string | number;
  total_items: string | number;
  total_pages: string | number;
};

const ARTICLE_COLUMNS = `a.id, a.slug, a.author_id, u.display_name AS author_name,
  u.avatar_path AS author_avatar_path, a.title, a.excerpt, ''::text AS body_markdown,
  ''::text AS paid_body_markdown, a.word_count, a.access_mode, a.unlock_soda_price,
  a.status, a.is_pinned, a.pinned_at, a.view_count, a.comment_count,
  a.created_at, a.updated_at, a.published_at`;

const COMMENT_COLUMNS = `c.id, c.article_id, c.author_id, u.display_name AS author_name,
  u.avatar_path AS author_avatar_path, c.body_markdown, c.status, c.created_at, c.updated_at`;

function positiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed.toISOString();
}

function articleStatus(value: string | null): OriginalArticleStatus {
  if (value !== "draft" && value !== "published" && value !== "hidden") {
    throw new Error("Invalid PostgreSQL original article status");
  }
  return value;
}

function accessMode(value: string | null, price: number): OriginalAccessMode {
  if (value !== "free" && value !== "paid") throw new Error("Invalid PostgreSQL original access mode");
  if ((price > 0) !== (value === "paid")) throw new Error("Inconsistent PostgreSQL original access mode");
  return value;
}

function commentStatus(value: string | null): "published" | "hidden" {
  if (value !== "published" && value !== "hidden") throw new Error("Invalid PostgreSQL original comment status");
  return value;
}

function parsedTags(value: unknown): OriginalTag[] {
  const decoded = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(decoded)) throw new Error("Invalid PostgreSQL original tags");
  return decoded.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid PostgreSQL original tag");
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || typeof row.slug !== "string") throw new Error("Invalid PostgreSQL original tag");
    return { id: positiveId(row.id, "original tag id"), name: row.name, slug: row.slug };
  });
}

function toArticle(row: ArticleRow): OriginalArticle {
  const price = integer(row.unlock_soda_price, "original unlock price");
  if (!row.slug || !row.author_name || !row.title || row.excerpt === null || row.body_markdown === null || row.paid_body_markdown === null) {
    throw new Error("Incomplete PostgreSQL original article");
  }
  const createdAt = timestamp(row.created_at, "original created timestamp");
  const updatedAt = timestamp(row.updated_at, "original updated timestamp");
  if (!createdAt || !updatedAt) throw new Error("Incomplete PostgreSQL original timestamps");
  return {
    id: positiveId(row.id, "original article id"),
    slug: row.slug,
    authorId: positiveId(row.author_id, "original author id"),
    authorName: row.author_name,
    authorAvatarPath: row.author_avatar_path,
    title: row.title,
    excerpt: row.excerpt,
    bodyMarkdown: row.body_markdown,
    paidBodyMarkdown: row.paid_body_markdown,
    wordCount: integer(row.word_count, "original word count"),
    accessMode: accessMode(row.access_mode, price),
    unlockSodaPrice: price,
    status: articleStatus(row.status),
    isPinned: row.is_pinned === true,
    pinnedAt: timestamp(row.pinned_at, "original pinned timestamp"),
    viewCount: integer(row.view_count, "original view count"),
    commentCount: integer(row.comment_count, "original comment count"),
    createdAt,
    updatedAt,
    publishedAt: timestamp(row.published_at, "original published timestamp"),
    tags: parsedTags(row.tags),
  };
}

function toComment(row: CommentRow): OriginalComment {
  if (!row.author_name || row.body_markdown === null) throw new Error("Incomplete PostgreSQL original comment");
  const createdAt = timestamp(row.created_at, "original comment created timestamp");
  const updatedAt = timestamp(row.updated_at, "original comment updated timestamp");
  if (!createdAt || !updatedAt) throw new Error("Incomplete PostgreSQL original comment timestamps");
  return {
    id: positiveId(row.id, "original comment id"),
    articleId: positiveId(row.article_id, "original comment article id"),
    authorId: positiveId(row.author_id, "original comment author id"),
    authorName: row.author_name,
    authorAvatarPath: row.author_avatar_path,
    bodyMarkdown: row.body_markdown,
    status: commentStatus(row.status),
    createdAt,
    updatedAt,
  };
}

function cleanText(value: unknown, maximum: number): string {
  return Array.from(String(value ?? "").normalize("NFKC").replace(/\r\n?/gu, "\n").trim())
    .slice(0, maximum)
    .join("");
}

function boundedPage(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(Math.floor(value ?? 1), 1) : 1;
}

function boundedPageSize(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value ?? fallback), 1), maximum) : fallback;
}

function tagsExpression(articleAlias = "a"): string {
  return `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug)
    ORDER BY lower(t.name), t.id) FROM original_article_tags at
    JOIN original_tags t ON t.id = at.tag_id WHERE at.article_id = ${articleAlias}.id), '[]'::jsonb) AS tags`;
}

function articleQuery(includeBody: boolean): string {
  return `SELECT a.id, a.slug, a.author_id, u.display_name AS author_name,
    u.avatar_path AS author_avatar_path, a.title, a.excerpt,
    ${includeBody ? "a.body_markdown" : "''::text AS body_markdown"},
    ${includeBody ? "a.paid_body_markdown" : "''::text AS paid_body_markdown"},
    a.word_count, a.access_mode, a.unlock_soda_price, a.status, a.is_pinned,
    a.pinned_at, a.view_count, a.comment_count, a.created_at, a.updated_at,
    a.published_at, ${tagsExpression("a")}
    FROM original_articles a JOIN users u ON u.id = a.author_id`;
}

function emptyArticleList(pageSize: number): OriginalArticleList {
  return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
}

export async function listOriginalTags(options: { publishedOnly?: boolean } = {}): Promise<OriginalTag[]> {
  const result = await database().query<QueryResultRow & { id: string | number; name: string; slug: string }>({
    name: options.publishedOnly ? "original-tags-published-v1" : "original-tags-all-v1",
    text: `SELECT t.id, t.name, t.slug FROM original_tags t
      ${options.publishedOnly ? `WHERE EXISTS (SELECT 1 FROM original_article_tags at
        JOIN original_articles a ON a.id = at.article_id
        WHERE at.tag_id = t.id AND a.status = 'published')` : ""}
      ORDER BY lower(t.name), t.id`,
  });
  return result.rows.map((row) => ({ id: positiveId(row.id, "original tag id"), name: row.name, slug: row.slug }));
}

export async function listOriginalTagSummaries(): Promise<Array<OriginalTag & { articleCount: number }>> {
  const result = await database().query<QueryResultRow & {
    id: string | number; name: string; slug: string; article_count: string | number;
  }>({
    name: "original-tag-summaries-v1",
    text: `SELECT t.id, t.name, t.slug, COUNT(DISTINCT a.id)::bigint AS article_count
      FROM original_tags t JOIN original_article_tags at ON at.tag_id = t.id
      JOIN original_articles a ON a.id = at.article_id AND a.status = 'published'
      GROUP BY t.id ORDER BY lower(t.name), t.id`,
  });
  return result.rows.map((row) => ({
    id: positiveId(row.id, "original tag id"), name: row.name, slug: row.slug,
    articleCount: integer(row.article_count, "original tag article count"),
  }));
}

export async function getOriginalTagBySlug(
  slugValue: string,
  options: { publishedOnly?: boolean } = {},
): Promise<OriginalTag | null> {
  const slug = normalizeOriginalSlug(slugValue).slice(0, 64).toLocaleLowerCase();
  if (!slug) return null;
  const result = await database().query<QueryResultRow & { id: string | number; name: string; slug: string }>({
    text: `SELECT t.id, t.name, t.slug FROM original_tags t WHERE lower(t.slug) = $1
      ${options.publishedOnly ? `AND EXISTS (SELECT 1 FROM original_article_tags at
        JOIN original_articles a ON a.id = at.article_id
        WHERE at.tag_id = t.id AND a.status = 'published')` : ""} LIMIT 1`,
    values: [slug],
  });
  const row = result.rows[0];
  return row ? { id: positiveId(row.id, "original tag id"), name: row.name, slug: row.slug } : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

export async function listOriginalArticles(options: {
  page?: number;
  pageSize?: number;
  query?: string;
  tagSlug?: string;
  sort?: OriginalSort;
  sortOrder?: OriginalSortOrder;
  includeUnpublished?: boolean;
  authorId?: number;
  viewerId?: number;
} = {}): Promise<OriginalArticleList> {
  const pageSize = boundedPageSize(options.pageSize, getOriginalPublishingSettings().pageSize, 100);
  const requestedPage = boundedPage(options.page);
  const conditions: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (!options.includeUnpublished) conditions.push("a.status = 'published'");
  if (Number.isSafeInteger(options.authorId) && Number(options.authorId) > 0) {
    conditions.push(`a.author_id = ${bind(Number(options.authorId))}`);
  }
  if (Number.isSafeInteger(options.viewerId) && Number(options.viewerId) > 0) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM user_original_author_blocks b
      WHERE b.user_id = ${bind(Number(options.viewerId))} AND b.author_id = a.author_id)`);
  }
  const terms = cleanText(options.query, 80).split(/\s+/u).filter(Boolean).slice(0, 8);
  for (const term of terms) {
    const parameter = bind(escapeLike(term));
    conditions.push(`(a.title ILIKE '%' || ${parameter} || '%' ESCAPE '\\'
      OR a.excerpt ILIKE '%' || ${parameter} || '%' ESCAPE '\\')`);
  }
  const tagSlug = cleanText(options.tagSlug, 64);
  if (tagSlug) {
    conditions.push(`EXISTS (SELECT 1 FROM original_article_tags at2 JOIN original_tags t2 ON t2.id = at2.tag_id
      WHERE at2.article_id = a.id AND lower(t2.slug) = lower(${bind(tagSlug)}))`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sort = options.sort === "popular" || options.sort === "name" ? options.sort : "latest";
  const sortOrder = normalizeOriginalSortOrder(options.sortOrder, sort);
  const descending = sortOrder === "desc";
  const selectedOrder = sort === "popular"
    ? (descending
      ? "a.view_count DESC, a.comment_count DESC, a.created_at DESC, a.id DESC"
      : "a.view_count ASC, a.comment_count ASC, a.created_at ASC, a.id ASC")
    : sort === "name"
      ? (descending
        ? `lower(a.title) COLLATE "C" DESC, a.id DESC`
        : `lower(a.title) COLLATE "C" ASC, a.id ASC`)
      : (descending
        ? "COALESCE(a.published_at, a.created_at) DESC, a.id DESC"
        : "COALESCE(a.published_at, a.created_at) ASC, a.id ASC");
  const order = `a.is_pinned DESC, a.pinned_at DESC NULLS LAST, ${selectedOrder}`;
  const requestedBind = bind(requestedPage);
  const pageSizeBind = bind(pageSize);
  const result = await database().query<ArticleRow & PageMetadata>({
    text: `WITH filtered AS MATERIALIZED (SELECT a.* FROM original_articles a ${where}),
      page_info AS (SELECT COUNT(*)::bigint AS total_items,
        GREATEST(CEIL(COUNT(*)::numeric / ${pageSizeBind}::integer), 1)::bigint AS total_pages FROM filtered),
      requested AS (SELECT total_items, total_pages, LEAST(${requestedBind}::bigint, total_pages) AS page FROM page_info)
      SELECT requested.total_items, requested.total_pages, requested.page, item.*,
        ${tagsExpression("item")}
      FROM requested LEFT JOIN LATERAL (
        SELECT ${ARTICLE_COLUMNS} FROM filtered a JOIN users u ON u.id = a.author_id
        ORDER BY ${order} LIMIT ${pageSizeBind} OFFSET ((requested.page - 1) * ${pageSizeBind})
      ) item ON TRUE`,
    values,
  });
  const first = result.rows[0];
  if (!first) return emptyArticleList(pageSize);
  return {
    items: result.rows.flatMap((row) => row.id === null ? [] : [toArticle(row)]),
    page: integer(first.page, "original page", 1),
    pageSize,
    totalItems: integer(first.total_items, "original total"),
    totalPages: integer(first.total_pages, "original total pages", 1),
  };
}

export async function listOriginalPurchasedArticles(
  buyerIdValue: number,
  options: { page?: number; pageSize?: number } = {},
): Promise<OriginalArticleList> {
  const pageSize = boundedPageSize(options.pageSize, getOriginalPublishingSettings().pageSize, 100);
  if (!Number.isSafeInteger(buyerIdValue) || buyerIdValue < 1) return emptyArticleList(pageSize);
  const buyerId = positiveId(buyerIdValue, "original purchase buyer id");
  const requestedPage = boundedPage(options.page);
  const result = await database().query<ArticleRow & PageMetadata>({
    text: `WITH purchased AS MATERIALIZED (
        SELECT a.*, p.created_at AS purchase_created_at, p.id AS purchase_id
        FROM original_purchases p JOIN original_articles a ON a.id = p.article_id
        WHERE p.buyer_id = $1 AND a.status = 'published'
      ), page_info AS (SELECT COUNT(*)::bigint AS total_items,
        GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages FROM purchased),
      requested AS (SELECT total_items, total_pages, LEAST($2::bigint, total_pages) AS page FROM page_info)
      SELECT requested.total_items, requested.total_pages, requested.page, item.*, ${tagsExpression("item")}
      FROM requested LEFT JOIN LATERAL (
        SELECT ${ARTICLE_COLUMNS}, a.purchase_created_at, a.purchase_id
        FROM purchased a JOIN users u ON u.id = a.author_id
        ORDER BY a.purchase_created_at DESC, a.purchase_id DESC LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) item ON TRUE`,
    values: [buyerId, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) return emptyArticleList(pageSize);
  return {
    items: result.rows.flatMap((row) => row.id === null ? [] : [toArticle(row)]),
    page: integer(first.page, "original purchase page", 1),
    pageSize,
    totalItems: integer(first.total_items, "original purchase total"),
    totalPages: integer(first.total_pages, "original purchase pages", 1),
  };
}

async function getArticle(where: string, value: string | number, includeUnpublished: boolean): Promise<OriginalArticle | null> {
  const result = await database().query<ArticleRow>({
    text: `${articleQuery(true)} WHERE ${where} ${includeUnpublished ? "" : "AND a.status = 'published'"} LIMIT 1`,
    values: [value],
  });
  return result.rows[0] ? toArticle(result.rows[0]) : null;
}

export async function getOriginalArticleBySlug(
  slugValue: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<OriginalArticle | null> {
  const slug = normalizeOriginalSlug(slugValue);
  return slug ? getArticle("a.slug = $1", slug, options.includeUnpublished === true) : null;
}

export async function getOriginalArticleById(
  articleIdValue: number,
  options: { includeUnpublished?: boolean } = {},
): Promise<OriginalArticle | null> {
  if (!Number.isSafeInteger(articleIdValue) || articleIdValue < 1) return null;
  return getArticle("a.id = $1", articleIdValue, options.includeUnpublished === true);
}

export async function getAdjacentOriginalArticles(articleIdValue: number, viewerId?: number): Promise<OriginalAdjacentArticles> {
  if (!Number.isSafeInteger(articleIdValue) || articleIdValue < 1) return { previous: null, next: null };
  const viewer = Number.isSafeInteger(viewerId) && Number(viewerId) > 0 ? Number(viewerId) : null;
  const result = await database().query<QueryResultRow & {
    previous_id: string | number | null; previous_slug: string | null; previous_title: string | null;
    next_id: string | number | null; next_slug: string | null; next_title: string | null;
  }>({
    name: "original-adjacent-v1",
    text: `WITH current AS (
        SELECT id, COALESCE(published_at, created_at) AS sort_time
        FROM original_articles WHERE id = $1 AND status = 'published'
      ) SELECT previous.id AS previous_id, previous.slug AS previous_slug, previous.title AS previous_title,
        next.id AS next_id, next.slug AS next_slug, next.title AS next_title
      FROM current
      LEFT JOIN LATERAL (SELECT a.id, a.slug, a.title FROM original_articles a
        WHERE a.status = 'published' AND (COALESCE(a.published_at, a.created_at), a.id) > (current.sort_time, current.id)
          AND ($2::bigint IS NULL OR NOT EXISTS (SELECT 1 FROM user_original_author_blocks b
            WHERE b.user_id = $2 AND b.author_id = a.author_id))
        ORDER BY COALESCE(a.published_at, a.created_at) ASC, a.id ASC LIMIT 1) previous ON TRUE
      LEFT JOIN LATERAL (SELECT a.id, a.slug, a.title FROM original_articles a
        WHERE a.status = 'published' AND (COALESCE(a.published_at, a.created_at), a.id) < (current.sort_time, current.id)
          AND ($2::bigint IS NULL OR NOT EXISTS (SELECT 1 FROM user_original_author_blocks b
            WHERE b.user_id = $2 AND b.author_id = a.author_id))
        ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC LIMIT 1) next ON TRUE`,
    values: [articleIdValue, viewer],
  });
  const row = result.rows[0];
  return {
    previous: row?.previous_id && row.previous_slug && row.previous_title
      ? { id: positiveId(row.previous_id, "previous original id"), slug: row.previous_slug, title: row.previous_title }
      : null,
    next: row?.next_id && row.next_slug && row.next_title
      ? { id: positiveId(row.next_id, "next original id"), slug: row.next_slug, title: row.next_title }
      : null,
  };
}

function commentWhere(options: { includeHidden?: boolean; viewerId?: number }, values: unknown[]): string {
  const conditions = options.includeHidden ? [] : ["c.status = 'published'"];
  if (Number.isSafeInteger(options.viewerId) && Number(options.viewerId) > 0) {
    values.push(Number(options.viewerId));
    conditions.push(`NOT EXISTS (SELECT 1 FROM user_original_author_blocks b
      WHERE b.user_id = $${values.length} AND b.author_id = c.author_id)`);
  }
  return conditions.length ? `AND ${conditions.join(" AND ")}` : "";
}

export async function listOriginalComments(
  articleIdValue: number,
  options: { includeHidden?: boolean; viewerId?: number } = {},
): Promise<OriginalComment[]> {
  if (!Number.isSafeInteger(articleIdValue) || articleIdValue < 1) return [];
  const values: unknown[] = [articleIdValue];
  const filter = commentWhere(options, values);
  const result = await database().query<CommentRow>({
    text: `SELECT ${COMMENT_COLUMNS} FROM original_comments c JOIN users u ON u.id = c.author_id
      WHERE c.article_id = $1 ${filter} ORDER BY c.created_at ASC, c.id ASC LIMIT 500`,
    values,
  });
  return result.rows.map(toComment);
}

export async function listOriginalCommentsPage(
  articleIdValue: number,
  options: { page?: number; pageSize?: number; includeHidden?: boolean; viewerId?: number } = {},
): Promise<OriginalCommentPage> {
  const pageSize = boundedPageSize(options.pageSize, 30, 50);
  if (!Number.isSafeInteger(articleIdValue) || articleIdValue < 1) {
    return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  }
  const values: unknown[] = [articleIdValue];
  const filter = commentWhere(options, values);
  values.push(boundedPage(options.page), pageSize);
  const requestedBind = `$${values.length - 1}`;
  const sizeBind = `$${values.length}`;
  const result = await database().query<CommentRow & PageMetadata>({
    text: `WITH filtered AS MATERIALIZED (SELECT c.* FROM original_comments c WHERE c.article_id = $1 ${filter}),
      page_info AS (SELECT COUNT(*)::bigint AS total_items,
        GREATEST(CEIL(COUNT(*)::numeric / ${sizeBind}::integer), 1)::bigint AS total_pages FROM filtered),
      requested AS (SELECT total_items, total_pages, LEAST(${requestedBind}::bigint, total_pages) AS page FROM page_info)
      SELECT requested.total_items, requested.total_pages, requested.page, item.*
      FROM requested LEFT JOIN LATERAL (
        SELECT ${COMMENT_COLUMNS} FROM filtered c JOIN users u ON u.id = c.author_id
        ORDER BY c.created_at ASC, c.id ASC LIMIT ${sizeBind} OFFSET ((requested.page - 1) * ${sizeBind})
      ) item ON TRUE`,
    values,
  });
  const first = result.rows[0];
  if (!first) return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  return {
    items: result.rows.flatMap((row) => row.id === null ? [] : [toComment(row)]),
    page: integer(first.page, "original comment page", 1),
    pageSize,
    totalItems: integer(first.total_items, "original comment total"),
    totalPages: integer(first.total_pages, "original comment pages", 1),
  };
}

export async function listOriginalCommentsByAuthor(
  authorIdValue: number,
  options: { page?: number; pageSize?: number; includeHidden?: boolean } = {},
): Promise<OriginalCommentActivityList> {
  const pageSize = boundedPageSize(options.pageSize, 20, 100);
  if (!Number.isSafeInteger(authorIdValue) || authorIdValue < 1) {
    return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  }
  const result = await database().query<CommentRow & PageMetadata & { article_slug: string | null; article_title: string | null }>({
    text: `WITH filtered AS MATERIALIZED (SELECT c.* FROM original_comments c
        WHERE c.author_id = $1 ${options.includeHidden ? "" : "AND c.status = 'published'"}),
      page_info AS (SELECT COUNT(*)::bigint AS total_items,
        GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages FROM filtered),
      requested AS (SELECT total_items, total_pages, LEAST($2::bigint, total_pages) AS page FROM page_info)
      SELECT requested.total_items, requested.total_pages, requested.page, item.*
      FROM requested LEFT JOIN LATERAL (
        SELECT ${COMMENT_COLUMNS}, a.slug AS article_slug, a.title AS article_title
        FROM filtered c JOIN users u ON u.id = c.author_id JOIN original_articles a ON a.id = c.article_id
        ORDER BY c.created_at DESC, c.id DESC LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) item ON TRUE`,
    values: [authorIdValue, boundedPage(options.page), pageSize],
  });
  const first = result.rows[0];
  if (!first) return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  return {
    items: result.rows.flatMap((row) => row.id === null ? [] : [{
      ...toComment(row),
      articleSlug: row.article_slug ?? "",
      articleTitle: row.article_title ?? "",
    }]),
    page: integer(first.page, "original comment activity page", 1),
    pageSize,
    totalItems: integer(first.total_items, "original comment activity total"),
    totalPages: integer(first.total_pages, "original comment activity pages", 1),
  };
}

function commentQuota(role: string, trustLevel: number, usedToday: number): OriginalCommentQuota {
  if (role === "admin") return { freeLimit: null, usedToday, remainingFree: null, nextCommentCost: 0 };
  const settings = getOriginalPublishingSettings();
  const freeLimit = Math.max(Math.floor(trustLevel || 1), 1) * settings.freeCommentsPerLevel;
  const remainingFree = Math.max(freeLimit - usedToday, 0);
  return { freeLimit, usedToday, remainingFree, nextCommentCost: remainingFree > 0 ? 0 : settings.commentCostSoda };
}

export async function getOriginalCommentQuota(
  user: Pick<PostgresUserProfile, "id" | "role" | "trustLevel">,
): Promise<OriginalCommentQuota> {
  const result = await database().query<QueryResultRow & { used_count: string | number }>({
    name: "original-comment-quota-v1",
    text: "SELECT used_count FROM original_comment_daily_usage WHERE user_id = $1 AND usage_date = $2::date",
    values: [positiveId(user.id, "original quota user id"), postgresSiteDateKey()],
  });
  return commentQuota(user.role, user.trustLevel, integer(result.rows[0]?.used_count, "original quota usage"));
}

export async function isOriginalAuthorBlocked(userIdValue: number, authorIdValue: number): Promise<boolean> {
  if (![userIdValue, authorIdValue].every((id) => Number.isSafeInteger(id) && id > 0)) return false;
  const result = await database().query({
    name: "original-author-blocked-v1",
    text: "SELECT 1 FROM user_original_author_blocks WHERE user_id = $1 AND author_id = $2",
    values: [userIdValue, authorIdValue],
  });
  return Boolean(result.rowCount);
}

export async function setOriginalAuthorBlocked(userIdValue: number, authorIdValue: number, blocked: boolean): Promise<boolean> {
  if (![userIdValue, authorIdValue].every((id) => Number.isSafeInteger(id) && id > 0) || userIdValue === authorIdValue) return false;
  if (!blocked) {
    const result = await database().query({
      text: "DELETE FROM user_original_author_blocks WHERE user_id = $1 AND author_id = $2",
      values: [userIdValue, authorIdValue],
    });
    return result.rowCount === 1;
  }
  const result = await database().query({
    text: `INSERT INTO user_original_author_blocks (user_id, author_id)
      SELECT viewer.id, author.id FROM users viewer CROSS JOIN users author
      WHERE viewer.id = $1 AND author.id = $2 AND viewer.status = 'active' AND viewer.deleted_at IS NULL
        AND author.status = 'active' AND author.deleted_at IS NULL
      ON CONFLICT DO NOTHING`,
    values: [userIdValue, authorIdValue],
  });
  return result.rowCount === 1;
}

export async function listBlockedOriginalAuthors(userIdValue: number): Promise<OriginalBlockedAuthor[]> {
  if (!Number.isSafeInteger(userIdValue) || userIdValue < 1) return [];
  const result = await database().query<QueryResultRow & {
    author_id: string | number; display_name: string; avatar_path: string | null;
    trust_level: string | number; article_count: string | number; created_at: Date | string;
  }>({
    name: "original-blocked-authors-v1",
    text: `SELECT b.author_id, u.display_name, u.avatar_path, u.trust_level, b.created_at,
        COUNT(a.id)::bigint AS article_count
      FROM user_original_author_blocks b JOIN users u ON u.id = b.author_id
      LEFT JOIN original_articles a ON a.author_id = b.author_id AND a.status = 'published'
      WHERE b.user_id = $1 GROUP BY b.author_id, u.display_name, u.avatar_path, u.trust_level, b.created_at
      ORDER BY b.created_at DESC, b.author_id DESC LIMIT 200`,
    values: [userIdValue],
  });
  return result.rows.map((row) => ({
    authorId: positiveId(row.author_id, "blocked original author id"),
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    trustLevel: integer(row.trust_level, "blocked author trust level"),
    articleCount: integer(row.article_count, "blocked author article count"),
    blockedAt: timestamp(row.created_at, "blocked author timestamp")!,
  }));
}

export async function hasOriginalPurchase(articleIdValue: number, userIdValue: number): Promise<boolean> {
  if (![articleIdValue, userIdValue].every((id) => Number.isSafeInteger(id) && id > 0)) return false;
  const result = await database().query({
    name: "original-purchase-exists-v1",
    text: "SELECT 1 FROM original_purchases WHERE article_id = $1 AND buyer_id = $2",
    values: [articleIdValue, userIdValue],
  });
  return Boolean(result.rowCount);
}

export async function getOriginalAccess(
  article: OriginalArticle,
  user: Pick<PostgresUserProfile, "id" | "role"> | null,
): Promise<OriginalAccess> {
  if (article.status !== "published") {
    return { allowed: Boolean(user?.role === "admin" || user?.id === article.authorId), purchased: false, reason: "hidden" };
  }
  if (!user) {
    return { allowed: article.accessMode === "free", purchased: false, reason: article.accessMode === "free" ? "public" : "login" };
  }
  if (user.role === "admin" || user.id === article.authorId) return { allowed: true, purchased: false, reason: "public" };
  const purchased = await hasOriginalPurchase(article.id, user.id);
  if (article.accessMode === "free") return { allowed: true, purchased, reason: "public" };
  return { allowed: purchased, purchased, reason: "purchase" };
}

type LockedUser = QueryResultRow & {
  id: string | number;
  status: string;
  role: string;
  trust_level: string | number;
  soda_balance: string | number;
  display_name: string;
  avatar_path: string | null;
};

async function chargeSoda(
  tx: SqlExecutor,
  userId: number,
  amount: number,
  source: string,
  referenceKey: string,
  note: string,
): Promise<number> {
  const fee = Math.max(Math.floor(amount), 0);
  const changed = await tx.query<QueryResultRow & { soda_balance: string | number }>({
    text: `UPDATE users SET soda_balance = soda_balance - $2, updated_at = clock_timestamp()
      WHERE id = $1 AND status = 'active' AND deleted_at IS NULL AND soda_balance >= $2 RETURNING soda_balance`,
    values: [userId, fee],
  });
  const row = changed.rows[0];
  if (!row) throw new OriginalInputError("苏打余额不足，请先兑换或签到");
  const balance = integer(row.soda_balance, "updated soda balance");
  if (fee > 0) {
    await tx.query({
      text: `INSERT INTO user_currency_transactions
        (user_id, currency, amount, balance_after, source, reference_key, note)
        VALUES ($1, 'soda', $2, $3, $4, $5, $6)`,
      values: [userId, -fee, balance, source, referenceKey, Array.from(note).slice(0, 240).join("")],
    });
  }
  return balance;
}

async function consumeCommentQuota(
  tx: SqlExecutor,
  user: { id: number; role: string; trustLevel: number },
  note: string,
): Promise<OriginalCommentMutationResult> {
  const day = postgresSiteDateKey();
  await tx.query({
    text: `INSERT INTO original_comment_daily_usage (user_id, usage_date, used_count)
      VALUES ($1, $2::date, 0) ON CONFLICT DO NOTHING`,
    values: [user.id, day],
  });
  const usage = await tx.query<QueryResultRow & { used_count: string | number }>({
    text: `SELECT used_count FROM original_comment_daily_usage
      WHERE user_id = $1 AND usage_date = $2::date FOR UPDATE`,
    values: [user.id, day],
  });
  const quota = commentQuota(user.role, user.trustLevel, integer(usage.rows[0]?.used_count, "locked comment quota usage"));
  if (quota.nextCommentCost > 0) {
    await chargeSoda(
      tx,
      user.id,
      quota.nextCommentCost,
      "original_comment",
      `original-comment:${user.id}:${crypto.randomUUID()}`,
      note,
    );
  }
  await tx.query({
    text: `UPDATE original_comment_daily_usage SET used_count = used_count + 1, updated_at = clock_timestamp()
      WHERE user_id = $1 AND usage_date = $2::date`,
    values: [user.id, day],
  });
  return {
    chargedSoda: quota.nextCommentCost,
    remainingFree: quota.remainingFree === null ? null : Math.max(quota.remainingFree - 1, 0),
  };
}

export async function purchaseOriginalArticle(
  articleIdValue: number,
  buyerIdValue: number,
): Promise<{ purchased: boolean; price: number }> {
  if (!canConsumeOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  if (![articleIdValue, buyerIdValue].every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new OriginalInputError("文章不存在或暂不可见");
  }
  return withTransaction(async (tx) => {
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      values: [`original-purchase:${articleIdValue}:${buyerIdValue}`],
    });
    const selected = await tx.query<QueryResultRow & {
      author_id: string | number; unlock_soda_price: string | number; status: string;
    }>({
      text: "SELECT author_id, unlock_soda_price, status FROM original_articles WHERE id = $1 FOR UPDATE",
      values: [articleIdValue],
    });
    const article = selected.rows[0];
    if (!article || article.status !== "published") throw new OriginalInputError("文章不存在或暂不可见");
    const authorId = positiveId(article.author_id, "original purchase author id");
    if (authorId === buyerIdValue) throw new OriginalInputError("作者无需购买自己的文章");
    const price = integer(article.unlock_soda_price, "original purchase price");
    if (price === 0) return { purchased: false, price: 0 };
    const existing = await tx.query({
      text: "SELECT 1 FROM original_purchases WHERE article_id = $1 AND buyer_id = $2",
      values: [articleIdValue, buyerIdValue],
    });
    if (existing.rowCount) return { purchased: true, price };
    const accounts = await tx.query<LockedUser>({
      text: `SELECT id, status, role, trust_level, soda_balance, display_name, avatar_path FROM users
        WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
      values: [[buyerIdValue, authorId]],
    });
    if (accounts.rows.length !== 2 || accounts.rows.some((row) => row.status !== "active")) {
      throw new OriginalInputError("用户不可用");
    }
    const buyer = accounts.rows.find((row) => Number(row.id) === buyerIdValue)!;
    const author = accounts.rows.find((row) => Number(row.id) === authorId)!;
    const buyerBalance = integer(buyer.soda_balance, "original buyer balance");
    const authorBalance = integer(author.soda_balance, "original author balance");
    if (buyerBalance < price) throw new OriginalInputError("苏打不足，无法解锁");
    const reference = `original-purchase:${articleIdValue}:${buyerIdValue}`;
    await tx.query({
      text: `UPDATE users SET soda_balance = CASE WHEN id = $1 THEN soda_balance - $3 ELSE soda_balance + $3 END,
        updated_at = clock_timestamp() WHERE id = ANY($2::bigint[])`,
      values: [buyerIdValue, [buyerIdValue, authorId], price],
    });
    await tx.query({
      text: `INSERT INTO original_purchases (article_id, buyer_id, author_id, price_soda, reference_key)
        VALUES ($1, $2, $3, $4, $5)`,
      values: [articleIdValue, buyerIdValue, authorId, price, reference],
    });
    await tx.query({
      text: `INSERT INTO user_currency_transactions
        (user_id, currency, amount, balance_after, source, reference_key, note) VALUES
        ($1, 'soda', $2, $3, 'original_purchase', $4, $5),
        ($6, 'soda', $7, $8, 'original_sale', $9, $10)`,
      values: [
        buyerIdValue, -price, buyerBalance - price, `${reference}:buyer`, `解锁原创文章 #${articleIdValue}`,
        authorId, price, authorBalance + price, `${reference}:author`, `原创文章 #${articleIdValue} 收益`,
      ],
    });
    return { purchased: true, price };
  }, { isolation: "serializable" });
}

function tipReference(articleId: number, senderId: number): string {
  return `original-tip:${articleId}:${senderId}`;
}

export async function hasTippedOriginalArticle(articleIdValue: number, senderIdValue: number): Promise<boolean> {
  if (![articleIdValue, senderIdValue].every((id) => Number.isSafeInteger(id) && id > 0)) return false;
  const reference = tipReference(articleIdValue, senderIdValue);
  const result = await database().query({
    name: "original-tip-exists-v1",
    text: `SELECT 1 FROM user_currency_transactions WHERE user_id = $1 AND source = 'original_tip'
      AND (reference_key = $2 OR reference_key LIKE $3) LIMIT 1`,
    values: [senderIdValue, `${reference}:sender`, `${reference}:%:sender`],
  });
  return Boolean(result.rowCount);
}

export async function tipOriginalAuthor(
  articleIdValue: number,
  senderIdValue: number,
): Promise<{ amount: 1; balance: number; authorId: number }> {
  if (!canConsumeOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  if (![articleIdValue, senderIdValue].every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new OriginalInputError("文章不存在或暂不可见");
  }
  return withTransaction(async (tx) => {
    const reference = tipReference(articleIdValue, senderIdValue);
    await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", values: [reference] });
    const selected = await tx.query<QueryResultRow & { author_id: string | number; title: string }>({
      text: "SELECT author_id, title FROM original_articles WHERE id = $1 AND status = 'published' FOR KEY SHARE",
      values: [articleIdValue],
    });
    const article = selected.rows[0];
    if (!article) throw new OriginalInputError("文章不存在或暂不可见");
    const authorId = positiveId(article.author_id, "original tip author id");
    if (authorId === senderIdValue) throw new OriginalInputError("不能打赏自己的文章");
    const tipped = await tx.query({
      text: `SELECT 1 FROM user_currency_transactions WHERE user_id = $1 AND source = 'original_tip'
        AND (reference_key = $2 OR reference_key LIKE $3) LIMIT 1`,
      values: [senderIdValue, `${reference}:sender`, `${reference}:%:sender`],
    });
    if (tipped.rowCount) throw new OriginalInputError("每篇文章只能打赏一次");
    const accounts = await tx.query<LockedUser>({
      text: `SELECT id, status, role, trust_level, soda_balance, display_name, avatar_path FROM users
        WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
      values: [[senderIdValue, authorId]],
    });
    if (accounts.rows.length !== 2 || accounts.rows.some((row) => row.status !== "active")) {
      throw new OriginalInputError("用户不可用");
    }
    const sender = accounts.rows.find((row) => Number(row.id) === senderIdValue)!;
    const author = accounts.rows.find((row) => Number(row.id) === authorId)!;
    const senderBalance = integer(sender.soda_balance, "original tip sender balance");
    const authorBalance = integer(author.soda_balance, "original tip author balance");
    if (senderBalance < 1) throw new OriginalInputError("苏打不足，无法打赏");
    await tx.query({
      text: `UPDATE users SET soda_balance = CASE WHEN id = $1 THEN soda_balance - 1 ELSE soda_balance + 1 END,
        updated_at = clock_timestamp() WHERE id = ANY($2::bigint[])`,
      values: [senderIdValue, [senderIdValue, authorId]],
    });
    const title = Array.from(article.title).slice(0, 80).join("");
    await tx.query({
      text: `INSERT INTO user_currency_transactions
        (user_id, currency, amount, balance_after, source, reference_key, note) VALUES
        ($1, 'soda', -1, $2, 'original_tip', $3, $4),
        ($5, 'soda', 1, $6, 'original_tip_income', $7, $8)`,
      values: [
        senderIdValue, senderBalance - 1, `${reference}:sender`, `打赏原创文章《${title}》`,
        authorId, authorBalance + 1, `${reference}:author`, `原创文章《${title}》收到打赏`,
      ],
    });
    return { amount: 1, balance: senderBalance - 1, authorId };
  }, { isolation: "serializable" });
}

async function lockedActiveUser(tx: SqlExecutor, userId: number): Promise<LockedUser> {
  const result = await tx.query<LockedUser>({
    text: `SELECT id, status, role, trust_level, soda_balance, display_name, avatar_path
      FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    values: [userId],
  });
  const row = result.rows[0];
  if (!row || row.status !== "active") throw new OriginalInputError("用户不可用");
  return row;
}

function normalizedComment(value: unknown): string {
  const body = cleanText(value, MAX_ORIGINAL_COMMENT_LENGTH);
  if (!body) throw new OriginalInputError("评论内容不能为空");
  const minimum = getOriginalPublishingSettings().commentMinChars;
  if (countOriginalWords(body) < minimum) throw new OriginalInputError(`评论至少需要 ${minimum} 个字符`);
  return body;
}

export async function addOriginalComment(
  articleIdValue: number,
  author: Pick<PostgresUserProfile, "id" | "role" | "trustLevel"> | number,
  bodyValue: unknown,
): Promise<OriginalCommentSubmitResult> {
  if (!canConsumeOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  const authorId = typeof author === "number" ? author : author.id;
  if (![articleIdValue, authorId].every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new OriginalInputError("文章不存在或暂不可见");
  }
  const body = normalizedComment(bodyValue);
  return withTransaction(async (tx) => {
    const article = await tx.query({
      text: "SELECT 1 FROM original_articles WHERE id = $1 AND status = 'published' FOR KEY SHARE",
      values: [articleIdValue],
    });
    if (!article.rowCount) throw new OriginalInputError("文章不存在或暂不可见");
    const user = await lockedActiveUser(tx, authorId);
    const mutation = await consumeCommentQuota(tx, {
      id: authorId,
      role: user.role,
      trustLevel: integer(user.trust_level, "original commenter trust level"),
    }, `回复原创文章 #${articleIdValue}`);
    const inserted = await tx.query<CommentRow>({
      text: `INSERT INTO original_comments (article_id, author_id, body_markdown)
        VALUES ($1, $2, $3) RETURNING id, article_id, author_id, $4::text AS author_name,
        $5::text AS author_avatar_path, body_markdown, status, created_at, updated_at`,
      values: [articleIdValue, authorId, body, user.display_name, user.avatar_path],
    });
    const comment = toComment(inserted.rows[0]);
    return { ...comment, comment, ...mutation };
  });
}

export async function updateOriginalComment(
  commentIdValue: number,
  authorIdValue: number,
  bodyValue: unknown,
): Promise<OriginalCommentUpdateResult> {
  if (![commentIdValue, authorIdValue].every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new OriginalInputError("回复不存在");
  }
  const body = normalizedComment(bodyValue);
  return withTransaction(async (tx) => {
    const user = await lockedActiveUser(tx, authorIdValue);
    const selected = await tx.query<CommentRow>({
      text: `SELECT ${COMMENT_COLUMNS} FROM original_comments c JOIN users u ON u.id = c.author_id
        WHERE c.id = $1 AND c.author_id = $2 FOR UPDATE OF c`,
      values: [commentIdValue, authorIdValue],
    });
    if (!selected.rows[0]) throw new OriginalInputError("回复不存在或没有编辑权限");
    const mutation = await consumeCommentQuota(tx, {
      id: authorIdValue,
      role: user.role,
      trustLevel: integer(user.trust_level, "original commenter trust level"),
    }, `编辑原创回复 #${commentIdValue}`);
    const changed = await tx.query<CommentRow>({
      text: `UPDATE original_comments SET body_markdown = $2, updated_at = clock_timestamp() WHERE id = $1
        RETURNING id, article_id, author_id, $3::text AS author_name, $4::text AS author_avatar_path,
          body_markdown, status, created_at, updated_at`,
      values: [commentIdValue, body, user.display_name, user.avatar_path],
    });
    return { ...toComment(changed.rows[0]), ...mutation };
  });
}

export async function deleteOriginalComment(
  commentIdValue: number,
  authorIdValue: number,
): Promise<OriginalCommentMutationResult | null> {
  if (![commentIdValue, authorIdValue].every((id) => Number.isSafeInteger(id) && id > 0)) return null;
  return withTransaction(async (tx) => {
    const user = await lockedActiveUser(tx, authorIdValue);
    const selected = await tx.query({
      text: "SELECT 1 FROM original_comments WHERE id = $1 AND author_id = $2 FOR UPDATE",
      values: [commentIdValue, authorIdValue],
    });
    if (!selected.rowCount) return null;
    const mutation = await consumeCommentQuota(tx, {
      id: authorIdValue,
      role: user.role,
      trustLevel: integer(user.trust_level, "original commenter trust level"),
    }, `删除原创回复 #${commentIdValue}`);
    await tx.query({
      text: "DELETE FROM original_comments WHERE id = $1 AND author_id = $2",
      values: [commentIdValue, authorIdValue],
    });
    return mutation;
  });
}

function safeIds(values: readonly number[]): number[] {
  return [...new Set(values.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 200);
}

export async function setOriginalArticleStatus(
  articleIdValue: number,
  statusValue: OriginalArticleStatus,
): Promise<boolean> {
  if (!Number.isSafeInteger(articleIdValue) || articleIdValue < 1) return false;
  const status: OriginalArticleStatus = statusValue === "published" ? "published" : statusValue === "draft" ? "draft" : "hidden";
  const result = await database().query({
    text: `UPDATE original_articles SET status = $2,
      published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, clock_timestamp()) ELSE published_at END,
      is_pinned = CASE WHEN $2 = 'published' THEN is_pinned ELSE FALSE END,
      pinned_at = CASE WHEN $2 = 'published' THEN pinned_at ELSE NULL END,
      updated_at = clock_timestamp() WHERE id = $1 AND status IS DISTINCT FROM $2`,
    values: [articleIdValue, status],
  });
  return result.rowCount === 1;
}

/** Batch moderation: hide published articles, or restore hidden ones. Restoring never
 *  publishes a draft its author has not published. */
export async function setOriginalArticlesStatus(
  idsValue: readonly number[],
  statusValue: "published" | "hidden",
): Promise<number> {
  const ids = safeIds(idsValue);
  if (!ids.length) return 0;
  const status = statusValue === "published" ? "published" : "hidden";
  const result = await database().query({
    text: `UPDATE original_articles SET status = $2,
      published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, clock_timestamp()) ELSE published_at END,
      is_pinned = CASE WHEN $2 = 'published' THEN is_pinned ELSE FALSE END,
      pinned_at = CASE WHEN $2 = 'published' THEN pinned_at ELSE NULL END,
      updated_at = clock_timestamp()
      WHERE id = ANY($1::bigint[]) AND status = CASE WHEN $2 = 'published' THEN 'hidden' ELSE 'published' END`,
    values: [ids, status],
  });
  return result.rowCount ?? 0;
}

export async function deleteOriginalArticles(idsValue: readonly number[]): Promise<number> {
  const ids = safeIds(idsValue);
  if (!ids.length) return 0;
  const result = await database().query({
    text: "DELETE FROM original_articles WHERE id = ANY($1::bigint[])",
    values: [ids],
  });
  return result.rowCount ?? 0;
}

export async function deleteOriginalComments(idsValue: readonly number[]): Promise<number> {
  const ids = safeIds(idsValue);
  if (!ids.length) return 0;
  const result = await database().query({
    text: "DELETE FROM original_comments WHERE id = ANY($1::bigint[])",
    values: [ids],
  });
  return result.rowCount ?? 0;
}

export async function setOriginalArticlePinned(articleIdValue: number, pinned: boolean): Promise<boolean> {
  if (!Number.isSafeInteger(articleIdValue) || articleIdValue < 1) return false;
  const result = await database().query({
    text: `UPDATE original_articles SET is_pinned = $2,
      pinned_at = CASE WHEN $2 THEN clock_timestamp() ELSE NULL END, updated_at = clock_timestamp()
      WHERE id = $1 AND is_pinned IS DISTINCT FROM $2 AND (NOT $2 OR status = 'published')`,
    values: [articleIdValue, pinned],
  });
  return result.rowCount === 1;
}

export async function setOriginalCommentStatus(
  commentIdValue: number,
  statusValue: "published" | "hidden",
): Promise<boolean> {
  if (!Number.isSafeInteger(commentIdValue) || commentIdValue < 1) return false;
  const status = statusValue === "hidden" ? "hidden" : "published";
  const result = await database().query({
    text: `UPDATE original_comments SET status = $2, updated_at = clock_timestamp()
      WHERE id = $1 AND status IS DISTINCT FROM $2`,
    values: [commentIdValue, status],
  });
  return result.rowCount === 1;
}

