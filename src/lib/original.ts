import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canAccessOriginalChannel, canConsumeOriginalChannel, getCookieToSodaRate, getOriginalPublishingSettings } from "./config";
import { getDb } from "./db";
import { getSiteDateKey } from "./user-economy";
import type { UserProfile } from "./users";
import {
  countOriginalWords,
  isValidOriginalTagName,
  MAX_ORIGINAL_BODY_LENGTH,
  MAX_ORIGINAL_COMMENT_LENGTH,
  normalizeOriginalTagName,
  ORIGINAL_PAID_MARKER,
} from "./original-constants";

export { MAX_ORIGINAL_BODY_LENGTH } from "./original-constants";

/** The price is the single source of truth for article access. */
export type OriginalAccessMode = "free" | "paid";
export type OriginalArticleStatus = "draft" | "published" | "hidden";
export type OriginalSort = "latest" | "popular" | "name";

export type OriginalTag = {
  id: number;
  name: string;
  slug: string;
};

export type OriginalArticle = {
  id: number;
  slug: string;
  authorId: number;
  authorName: string;
  authorAvatarPath: string | null;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  paidBodyMarkdown: string;
  wordCount: number;
  accessMode: OriginalAccessMode;
  unlockSodaPrice: number;
  status: OriginalArticleStatus;
  isPinned: boolean;
  pinnedAt: string | null;
  viewCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  tags: OriginalTag[];
};

export type OriginalComment = {
  id: number;
  articleId: number;
  authorId: number;
  authorName: string;
  authorAvatarPath: string | null;
  bodyMarkdown: string;
  status: "published" | "hidden";
  createdAt: string;
  updatedAt: string;
};

export type OriginalCommentActivity = OriginalComment & {
  articleSlug: string;
  articleTitle: string;
};

export type OriginalCommentQuota = {
  freeLimit: number | null;
  usedToday: number;
  remainingFree: number | null;
  nextCommentCost: number;
};

export type OriginalCommentSubmitResult = OriginalComment & {
  comment: OriginalComment;
  chargedSoda: number;
  remainingFree: number | null;
};

export type OriginalCommentMutationResult = {
  chargedSoda: number;
  remainingFree: number | null;
};

export type OriginalCommentUpdateResult = OriginalComment & OriginalCommentMutationResult;

export type OriginalBlockedAuthor = {
  authorId: number;
  displayName: string;
  avatarPath: string | null;
  trustLevel: number;
  articleCount: number;
  blockedAt: string;
};

export type OriginalAdjacentArticles = {
  previous: Pick<OriginalArticle, "id" | "slug" | "title"> | null;
  next: Pick<OriginalArticle, "id" | "slug" | "title"> | null;
};

export type OriginalCommentActivityList = {
  items: OriginalCommentActivity[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type OriginalArticleList = {
  items: OriginalArticle[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type OriginalReadingHistoryItem = {
  articleId: number;
  slug: string;
  title: string;
  authorId: number;
  authorName: string;
  authorAvatarPath: string | null;
  wordCount: number;
  unlockSodaPrice: number;
  visitCount: number;
  scrollRatio: number;
  progressPercent: number;
  completed: boolean;
  lastReadAt: string;
};

export type OriginalCommentPage = {
  items: OriginalComment[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type OriginalReadingProgress = Pick<
  OriginalReadingHistoryItem,
  "articleId" | "scrollRatio" | "progressPercent" | "completed" | "visitCount" | "lastReadAt"
>;

export type OriginalReadingHistoryPage = {
  items: OriginalReadingHistoryItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type OriginalAccess = {
  allowed: boolean;
  purchased: boolean;
  reason: "public" | "purchase" | "hidden" | "login";
};

export class OriginalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginalInputError";
  }
}

const MAX_TITLE_LENGTH = 120;
const MAX_EXCERPT_LENGTH = 320;

type ArticleRow = {
  id: number;
  slug: string;
  author_id: number;
  author_name: string;
  author_avatar_path: string | null;
  title: string;
  excerpt: string;
  body_markdown: string;
  paid_body_markdown: string;
  word_count: number;
  access_mode: OriginalAccessMode;
  unlock_soda_price: number;
  status: OriginalArticleStatus;
  is_pinned: number;
  pinned_at: string | null;
  view_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type TagRow = { id: number; name: string; slug: string; article_id?: number };

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .trim()
    .slice(0, maxLength);
}

/** Normalize a slug received from a URL segment. Some clients pass an already
 * percent-encoded dynamic segment, while Next normally gives us decoded text.
 * Accept both forms so links remain stable across browsers and rewrites. */
export function normalizeOriginalSlug(value: unknown): string {
  let normalized = String(value ?? "");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    } catch {
      break;
    }
  }
  return cleanText(normalized, 100);
}

function slugBase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72) || "article";
}

function uniqueSlug(db: DatabaseSync, value: string, exceptId = 0): string {
  const base = slugBase(value);
  let candidate = base;
  let suffix = 2;
  while (db.prepare("SELECT 1 AS found FROM original_articles WHERE slug = ? AND id <> ?").get(candidate, exceptId)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, 72 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeTagNames(value: unknown, maxTags: number): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\n,，、]+/u);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of raw) {
    const name = normalizeOriginalTagName(item);
    if (!name) continue;
    if (!isValidOriginalTagName(name)) {
      throw new OriginalInputError("中文标签需为 2–6 个汉字，英文标签需为 2–15 个字母且不能包含空格或符号");
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    if (names.length >= maxTags) throw new OriginalInputError(`每篇文章最多添加 ${maxTags} 个标签`);
    seen.add(key);
    names.push(name);
  }
  return names;
}

function tagSlug(value: string): string {
  return slugBase(value).slice(0, 64) || "tag";
}

function excerptFromBody(body: string): string {
  return body
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[*_`>#\[\]()~-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_EXCERPT_LENGTH);
}

function normalizeBody(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .slice(0, MAX_ORIGINAL_BODY_LENGTH);
}

/**
 * Split at the editor marker without normalising the surrounding whitespace.
 * The marker is presentation metadata; every newline authored by the writer
 * must survive both saving and unlocking.
 */
function splitAtPaidMarker(body: string): { publicBody: string; paidBody: string } {
  const markerIndex = body.indexOf(ORIGINAL_PAID_MARKER);
  if (markerIndex < 0) return { publicBody: body, paidBody: "" };
  const before = body.slice(0, markerIndex);
  const after = body.slice(markerIndex + ORIGINAL_PAID_MARKER.length);
  return { publicBody: before, paidBody: after };
}

function removePaidMarkers(body: string): string {
  return body.split(ORIGINAL_PAID_MARKER).join("");
}

function splitArticleBody(bodyValue: unknown, price: number): { publicBody: string; paidBody: string } {
  const body = normalizeBody(bodyValue);
  if (!body.trim()) throw new OriginalInputError("请输入文章内容");
  if (price <= 0) {
    return { publicBody: removePaidMarkers(body), paidBody: "" };
  }
  if (body.indexOf(ORIGINAL_PAID_MARKER) < 0 || body.indexOf(ORIGINAL_PAID_MARKER) !== body.lastIndexOf(ORIGINAL_PAID_MARKER)) {
    throw new OriginalInputError("付费文章需要插入一个付费分界");
  }
  const { publicBody, paidBody } = splitAtPaidMarker(body);
  if (!publicBody.trim() || !paidBody.trim()) {
    throw new OriginalInputError("付费分界前后都需要正文内容");
  }
  return { publicBody, paidBody };
}

function normalizeAccessMode(_value: unknown, unlockSodaPrice = 0): OriginalAccessMode {
  return Math.floor(Number(unlockSodaPrice) || 0) > 0 ? "paid" : "free";
}

function normalizeStatus(value: unknown): OriginalArticleStatus {
  return value === "draft" || value === "hidden" ? value : "published";
}

function toArticle(row: ArticleRow, tags: OriginalTag[] = []): OriginalArticle {
  const unlockSodaPrice = Math.max(Math.floor(row.unlock_soda_price || 0), 0);
  return {
    id: row.id,
    slug: row.slug,
    authorId: row.author_id,
    authorName: row.author_name,
    authorAvatarPath: row.author_avatar_path || null,
    title: row.title,
    excerpt: row.excerpt,
    bodyMarkdown: row.body_markdown,
    paidBodyMarkdown: row.paid_body_markdown,
    wordCount: Math.max(Math.floor(row.word_count || 0), countOriginalWords(`${row.body_markdown || ""}${row.paid_body_markdown || ""}`)),
    accessMode: normalizeAccessMode(row.access_mode, unlockSodaPrice),
    unlockSodaPrice,
    status: normalizeStatus(row.status),
    isPinned: row.is_pinned === 1,
    pinnedAt: row.pinned_at || null,
    viewCount: Math.max(Math.floor(row.view_count || 0), 0),
    commentCount: Math.max(Math.floor(row.comment_count || 0), 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    tags,
  };
}

function articleSelect(includeBody = false): string {
  return `SELECT a.id, a.slug, a.author_id, u.display_name AS author_name,
                 u.avatar_path AS author_avatar_path,
                 a.title, a.excerpt,
                 ${includeBody ? "a.body_markdown" : "'' AS body_markdown"},
                 ${includeBody ? "a.paid_body_markdown" : "'' AS paid_body_markdown"},
                 a.word_count,
                 a.access_mode,
                 a.unlock_soda_price, a.status, a.is_pinned, a.pinned_at,
                 a.view_count, a.comment_count,
                 a.created_at, a.updated_at, a.published_at
          FROM original_articles a
          JOIN users u ON u.id = a.author_id`;
}

function articleTags(articleIds: number[]): Map<number, OriginalTag[]> {
  const map = new Map<number, OriginalTag[]>();
  const ids = Array.from(new Set(articleIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) return map;
  const rows = getDb().prepare(
    `SELECT at.article_id, t.id, t.name, t.slug
     FROM original_article_tags at
     JOIN original_tags t ON t.id = at.tag_id
     WHERE at.article_id IN (${ids.map(() => "?").join(",")})
     ORDER BY t.name COLLATE NOCASE ASC, t.id ASC`,
  ).all(...ids) as TagRow[];
  for (const row of rows) {
    const list = map.get(row.article_id!) || [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    map.set(row.article_id!, list);
  }
  return map;
}

function attachTags(rows: ArticleRow[]): OriginalArticle[] {
  const tags = articleTags(rows.map((row) => row.id));
  return rows.map((row) => toArticle(row, tags.get(row.id) || []));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

export function listOriginalTags(options: { publishedOnly?: boolean } = {}): OriginalTag[] {
  const sql = options.publishedOnly
    ? `SELECT t.id, t.name, t.slug
       FROM original_tags t
       WHERE EXISTS (
         SELECT 1
         FROM original_article_tags at
         JOIN original_articles a ON a.id = at.article_id
         WHERE at.tag_id = t.id AND a.status = 'published'
       )
       ORDER BY t.name COLLATE NOCASE ASC, t.id ASC`
    : "SELECT id, name, slug FROM original_tags ORDER BY name COLLATE NOCASE ASC, id ASC";
  return (getDb().prepare(sql).all() as TagRow[])
    .map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

export function listOriginalTagSummaries(): Array<OriginalTag & { articleCount: number }> {
  const rows = getDb().prepare(
    `SELECT t.id, t.name, t.slug, COUNT(DISTINCT a.id) AS article_count
     FROM original_tags t
     JOIN original_article_tags at ON at.tag_id = t.id
     JOIN original_articles a ON a.id = at.article_id AND a.status = 'published'
     GROUP BY t.id
     ORDER BY t.name COLLATE NOCASE ASC, t.id ASC`,
  ).all() as Array<TagRow & { article_count: number }>;
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, articleCount: row.article_count }));
}

export function getOriginalTagBySlug(slug: string, options: { publishedOnly?: boolean } = {}): OriginalTag | null {
  const normalized = normalizeOriginalSlug(slug).slice(0, 64).toLocaleLowerCase();
  if (!normalized) return null;
  const visibility = options.publishedOnly
    ? `AND EXISTS (
         SELECT 1 FROM original_article_tags at
         JOIN original_articles a ON a.id = at.article_id
         WHERE at.tag_id = t.id AND a.status = 'published'
       )`
    : "";
  const row = getDb().prepare(`SELECT t.id, t.name, t.slug FROM original_tags t WHERE t.slug = ? ${visibility}`).get(normalized) as TagRow | undefined;
  return row ? { id: row.id, name: row.name, slug: row.slug } : null;
}

export function listOriginalArticles(options: {
  page?: number;
  pageSize?: number;
  query?: string;
  tagSlug?: string;
  sort?: OriginalSort;
  includeUnpublished?: boolean;
  authorId?: number;
  viewerId?: number;
} = {}): OriginalArticleList {
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || getOriginalPublishingSettings().pageSize), 1), 100);
  const query = cleanText(options.query, 80);
  const tagSlug = cleanText(options.tagSlug, 64);
  const conditions: string[] = [];
  const args: Array<string | number> = [];
  if (!options.includeUnpublished) conditions.push("a.status = 'published'");
  if (options.authorId) {
    conditions.push("a.author_id = ?");
    args.push(options.authorId);
  }
  if (Number.isSafeInteger(options.viewerId) && Number(options.viewerId) > 0) {
    conditions.push("NOT EXISTS (SELECT 1 FROM user_original_author_blocks b WHERE b.user_id = ? AND b.author_id = a.author_id)");
    args.push(Number(options.viewerId));
  }
  const queryTerms = query.split(/\s+/u).filter(Boolean).slice(0, 8);
  for (const term of queryTerms) {
    conditions.push("(a.title LIKE ? ESCAPE '\\' OR a.excerpt LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(term)}%`;
    args.push(pattern, pattern);
  }
  if (tagSlug) {
    conditions.push("EXISTS (SELECT 1 FROM original_article_tags at2 JOIN original_tags t2 ON t2.id = at2.tag_id WHERE at2.article_id = a.id AND t2.slug = ?)");
    args.push(tagSlug);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS count FROM original_articles a ${where}`).get(...args) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = Math.min(Math.max(Math.floor(options.page || 1), 1), totalPages);
  const selectedOrder = options.sort === "popular"
    ? "a.view_count DESC, a.comment_count DESC, a.created_at DESC, a.id DESC"
    : options.sort === "name"
      ? "a.title COLLATE NOCASE ASC, a.id ASC"
      : "COALESCE(a.published_at, a.created_at) DESC, a.id DESC";
  const order = `a.is_pinned DESC, CASE WHEN a.is_pinned = 1 THEN a.pinned_at END DESC, ${selectedOrder}`;
  const rows = db.prepare(`${articleSelect()} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize) as ArticleRow[];
  return { items: attachTags(rows), page, pageSize, totalItems: total.count, totalPages };
}

/** Articles unlocked by the current user, ordered by the most recent purchase. */
export function listOriginalPurchasedArticles(
  buyerId: number,
  options: { page?: number; pageSize?: number } = {},
): OriginalArticleList {
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || getOriginalPublishingSettings().pageSize), 1), 100);
  if (!Number.isSafeInteger(buyerId) || buyerId <= 0) {
    return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  }
  const db = getDb();
  const totalItems = (db.prepare(
    `SELECT COUNT(*) AS count
     FROM original_purchases p
     JOIN original_articles a ON a.id = p.article_id
     WHERE p.buyer_id = ? AND a.status = 'published'`,
  ).get(buyerId) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(Math.floor(options.page || 1), 1), totalPages);
  const rows = db.prepare(
    `${articleSelect()}
     JOIN original_purchases p ON p.article_id = a.id AND p.buyer_id = ?
     WHERE a.status = 'published'
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
  ).all(buyerId, pageSize, (page - 1) * pageSize) as ArticleRow[];
  return { items: attachTags(rows), page, pageSize, totalItems, totalPages };
}

export function getOriginalArticleBySlug(slug: string, options: { includeUnpublished?: boolean } = {}): OriginalArticle | null {
  const normalized = normalizeOriginalSlug(slug);
  if (!normalized) return null;
  const visibility = options.includeUnpublished ? "" : "AND a.status = 'published'";
  const row = getDb().prepare(`${articleSelect(true)} WHERE a.slug = ? ${visibility}`).get(normalized) as ArticleRow | undefined;
  return row ? attachTags([row])[0] : null;
}

export function getOriginalArticleById(articleId: number, options: { includeUnpublished?: boolean } = {}): OriginalArticle | null {
  if (!Number.isSafeInteger(articleId) || articleId <= 0) return null;
  const visibility = options.includeUnpublished ? "" : "AND a.status = 'published'";
  const row = getDb().prepare(`${articleSelect(true)} WHERE a.id = ? ${visibility}`).get(articleId) as ArticleRow | undefined;
  return row ? attachTags([row])[0] : null;
}

/** Adjacent published articles in the same chronological stream used by the
 * public list. Blocked authors are skipped for the active reader. */
export function getAdjacentOriginalArticles(articleId: number, viewerId?: number): OriginalAdjacentArticles {
  if (!Number.isSafeInteger(articleId) || articleId <= 0) return { previous: null, next: null };
  const db = getDb();
  const current = db.prepare(
    `SELECT COALESCE(published_at, created_at) AS sort_time, id
     FROM original_articles WHERE id = ? AND status = 'published'`,
  ).get(articleId) as { sort_time: string; id: number } | undefined;
  if (!current) return { previous: null, next: null };
  const blockSql = Number.isSafeInteger(viewerId) && Number(viewerId) > 0
    ? "AND NOT EXISTS (SELECT 1 FROM user_original_author_blocks b WHERE b.user_id = ? AND b.author_id = a.author_id)"
    : "";
  const blockArgs = blockSql ? [Number(viewerId)] : [];
  const select = "SELECT a.id, a.slug, a.title FROM original_articles a";
  const previous = db.prepare(
    `${select}
     WHERE a.status = 'published'
       AND (COALESCE(a.published_at, a.created_at) > ? OR (COALESCE(a.published_at, a.created_at) = ? AND a.id > ?))
       ${blockSql}
     ORDER BY COALESCE(a.published_at, a.created_at) ASC, a.id ASC
     LIMIT 1`,
  ).get(current.sort_time, current.sort_time, current.id, ...blockArgs) as { id: number; slug: string; title: string } | undefined;
  const next = db.prepare(
    `${select}
     WHERE a.status = 'published'
       AND (COALESCE(a.published_at, a.created_at) < ? OR (COALESCE(a.published_at, a.created_at) = ? AND a.id < ?))
       ${blockSql}
     ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
     LIMIT 1`,
  ).get(current.sort_time, current.sort_time, current.id, ...blockArgs) as { id: number; slug: string; title: string } | undefined;
  return { previous: previous || null, next: next || null };
}

/** Resolve a bounded article id set without loading Markdown bodies. The
 * result follows the caller's id order so mixed collections stay stable. */
export function listOriginalArticlesByIds(
  articleIds: readonly number[],
  options: { includeUnpublished?: boolean } = {},
): OriginalArticle[] {
  const ids = Array.from(new Set(articleIds.filter((id) => Number.isSafeInteger(id) && id > 0))).slice(0, 100);
  if (!ids.length) return [];
  const visibility = options.includeUnpublished ? "" : "AND a.status = 'published'";
  const rows = getDb().prepare(
    `${articleSelect()} WHERE a.id IN (${ids.map(() => "?").join(",")}) ${visibility}`,
  ).all(...ids) as ArticleRow[];
  const articles = new Map(attachTags(rows).map((article) => [article.id, article]));
  return ids.flatMap((id) => {
    const article = articles.get(id);
    return article ? [article] : [];
  });
}

function clampReadingValue(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);
}

function toOriginalReadingProgress(row: {
  article_id: number;
  scroll_ratio: number;
  progress_percent: number;
  completed: number;
  visit_count: number;
  last_read_at: string;
}): OriginalReadingProgress {
  return {
    articleId: row.article_id,
    scrollRatio: clampReadingValue(row.scroll_ratio, 0, 1),
    progressPercent: clampReadingValue(row.progress_percent, 0, 100),
    completed: row.completed === 1,
    visitCount: Math.max(Math.floor(row.visit_count || 0), 0),
    lastReadAt: row.last_read_at,
  };
}

export function getOriginalReadingProgress(userId: number, articleId: number): OriginalReadingProgress | null {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(articleId) || articleId <= 0) return null;
  const row = getDb().prepare(
    `SELECT article_id, scroll_ratio, progress_percent, completed, visit_count, last_read_at
     FROM original_reading_history
     WHERE user_id = ? AND article_id = ?`,
  ).get(userId, articleId) as {
    article_id: number;
    scroll_ratio: number;
    progress_percent: number;
    completed: number;
    visit_count: number;
    last_read_at: string;
  } | undefined;
  return row ? toOriginalReadingProgress(row) : null;
}

export function updateOriginalReadingProgress(
  userId: number,
  articleId: number,
  scrollRatioValue: number,
): { saved: boolean; progress: OriginalReadingProgress | null } {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(articleId) || articleId <= 0) {
    return { saved: false, progress: null };
  }
  const db = getDb();
  const allowed = db.prepare(
    `SELECT 1 AS found
     FROM users u, original_articles a
     WHERE u.id = ? AND u.status = 'active' AND u.original_reading_history_enabled = 1
       AND a.id = ? AND a.status = 'published'`,
  ).get(userId, articleId);
  if (!allowed) return { saved: false, progress: getOriginalReadingProgress(userId, articleId) };
  const scrollRatio = clampReadingValue(scrollRatioValue, 0, 1);
  const progressPercent = scrollRatio * 100;
  const completed = progressPercent >= 98;
  const existing = getOriginalReadingProgress(userId, articleId);
  if (
    existing &&
    Math.abs(existing.scrollRatio - scrollRatio) < 0.002 &&
    existing.completed === completed
  ) {
    return { saved: false, progress: existing };
  }
  db.prepare(
    `INSERT INTO original_reading_history (
       user_id, article_id, scroll_ratio, progress_percent, completed,
       recorded_in_history, visit_count, last_read_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       scroll_ratio = excluded.scroll_ratio,
       progress_percent = excluded.progress_percent,
       completed = CASE WHEN original_reading_history.completed = 1 THEN 1 ELSE excluded.completed END,
       recorded_in_history = 1,
       last_read_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(userId, articleId, scrollRatio, progressPercent, completed ? 1 : 0);
  return { saved: true, progress: getOriginalReadingProgress(userId, articleId) };
}

function normalizeOriginalHistoryIds(articleIds: readonly number[]): number[] {
  return Array.from(new Set(articleIds.filter((id) => Number.isSafeInteger(id) && id > 0))).slice(0, 100);
}

export function deleteOriginalReadingProgressMany(userId: number, articleIds: readonly number[]): number {
  const ids = normalizeOriginalHistoryIds(articleIds);
  if (!ids.length) return 0;
  return Number(getDb().prepare(
    `UPDATE original_reading_history
     SET recorded_in_history = 0, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND recorded_in_history = 1
       AND article_id IN (${ids.map(() => "?").join(",")})`,
  ).run(userId, ...ids).changes);
}

export function clearOriginalReadingProgress(userId: number): number {
  return Number(getDb().prepare(
    `UPDATE original_reading_history
     SET recorded_in_history = 0, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND recorded_in_history = 1`,
  ).run(userId).changes);
}

export function listOriginalReadingHistory(
  userId: number,
  options: { page?: number; pageSize?: number } = {},
): OriginalReadingHistoryPage {
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || 20), 1), 100);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  }
  const db = getDb();
  const totalItems = (db.prepare(
    `SELECT COUNT(*) AS count
     FROM original_reading_history h
     JOIN original_articles a ON a.id = h.article_id
     WHERE h.user_id = ? AND h.recorded_in_history = 1 AND a.status = 'published'`,
  ).get(userId) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(Math.floor(options.page || 1), 1), totalPages);
  const rows = db.prepare(
    `SELECT h.article_id, h.visit_count, h.scroll_ratio, h.progress_percent, h.completed, h.last_read_at,
            a.slug, a.title, a.author_id, u.display_name AS author_name,
            u.avatar_path AS author_avatar_path, a.word_count, a.unlock_soda_price
     FROM original_reading_history h
     JOIN original_articles a ON a.id = h.article_id
     JOIN users u ON u.id = a.author_id
     WHERE h.user_id = ? AND h.recorded_in_history = 1 AND a.status = 'published'
     ORDER BY h.last_read_at DESC, h.article_id DESC
     LIMIT ? OFFSET ?`,
  ).all(userId, pageSize, (page - 1) * pageSize) as Array<{
    article_id: number;
    visit_count: number;
    scroll_ratio: number;
    progress_percent: number;
    completed: number;
    last_read_at: string;
    slug: string;
    title: string;
    author_id: number;
    author_name: string;
    author_avatar_path: string | null;
    word_count: number;
    unlock_soda_price: number;
  }>;
  return {
    items: rows.map((row) => ({
      articleId: row.article_id,
      slug: row.slug,
      title: row.title,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatarPath: row.author_avatar_path || null,
      wordCount: Math.max(Math.floor(row.word_count || 0), 0),
      unlockSodaPrice: Math.max(Math.floor(row.unlock_soda_price || 0), 0),
      visitCount: Math.max(Math.floor(row.visit_count || 0), 0),
      scrollRatio: clampReadingValue(row.scroll_ratio, 0, 1),
      progressPercent: clampReadingValue(row.progress_percent, 0, 100),
      completed: row.completed === 1,
      lastReadAt: row.last_read_at,
    })),
    page,
    pageSize,
    totalItems,
    totalPages,
  };
}

type OriginalCommentRow = {
  id: number;
  article_id: number;
  author_id: number;
  author_name: string;
  author_avatar_path: string | null;
  body_markdown: string;
  status: "published" | "hidden";
  created_at: string;
  updated_at: string;
};

function toOriginalComment(row: OriginalCommentRow): OriginalComment {
  return {
    id: row.id,
    articleId: row.article_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorAvatarPath: row.author_avatar_path || null,
    bodyMarkdown: row.body_markdown,
    status: row.status === "hidden" ? "hidden" : "published",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function originalCommentVisibility(includeHidden?: boolean): string {
  return includeHidden ? "" : "AND c.status = 'published'";
}

function originalCommentBlockFilter(viewerId?: number): string {
  return Number.isSafeInteger(viewerId) && Number(viewerId) > 0
    ? "AND NOT EXISTS (SELECT 1 FROM user_original_author_blocks b WHERE b.user_id = ? AND b.author_id = c.author_id)"
    : "";
}

export function listOriginalComments(articleId: number, options: { includeHidden?: boolean; viewerId?: number } = {}): OriginalComment[] {
  if (!Number.isSafeInteger(articleId) || articleId <= 0) return [];
  const visibility = originalCommentVisibility(options.includeHidden);
  const blockFilter = originalCommentBlockFilter(options.viewerId);
  const args = blockFilter ? [articleId, Number(options.viewerId)] : [articleId];
  const rows = getDb().prepare(
    `SELECT c.id, c.article_id, c.author_id, u.display_name AS author_name,
            u.avatar_path AS author_avatar_path,
            c.body_markdown, c.status, c.created_at, c.updated_at
     FROM original_comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.article_id = ? ${visibility} ${blockFilter}
     ORDER BY c.created_at ASC, c.id ASC`,
  ).all(...args) as OriginalCommentRow[];
  return rows.map(toOriginalComment);
}

/** Bounded public comment read model; detail pages never load an unbounded thread. */
export function listOriginalCommentsPage(
  articleId: number,
  options: { page?: number; pageSize?: number; includeHidden?: boolean; viewerId?: number } = {},
): OriginalCommentPage {
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || 30), 1), 50);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) {
    return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  }
  const visibility = originalCommentVisibility(options.includeHidden);
  const blockFilter = originalCommentBlockFilter(options.viewerId);
  const filterArgs = blockFilter ? [articleId, Number(options.viewerId)] : [articleId];
  const db = getDb();
  const totalItems = (db.prepare(
    `SELECT COUNT(*) AS count
     FROM original_comments c
     WHERE c.article_id = ? ${visibility} ${blockFilter}`,
  ).get(...filterArgs) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(Math.floor(options.page || 1), 1), totalPages);
  const rows = db.prepare(
    `SELECT c.id, c.article_id, c.author_id, u.display_name AS author_name,
            u.avatar_path AS author_avatar_path,
            c.body_markdown, c.status, c.created_at, c.updated_at
     FROM original_comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.article_id = ? ${visibility} ${blockFilter}
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT ? OFFSET ?`,
  ).all(...filterArgs, pageSize, (page - 1) * pageSize) as OriginalCommentRow[];
  return { items: rows.map(toOriginalComment), page, pageSize, totalItems, totalPages };
}

export function listOriginalCommentsByAuthor(
  authorId: number,
  options: { page?: number; pageSize?: number; includeHidden?: boolean } = {},
): OriginalCommentActivityList {
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || 20), 1), 100);
  if (!Number.isSafeInteger(authorId) || authorId <= 0) {
    return { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  }
  const visibility = options.includeHidden ? "" : "AND c.status = 'published'";
  const db = getDb();
  const totalItems = (db.prepare(
    `SELECT COUNT(*) AS count FROM original_comments c WHERE c.author_id = ? ${visibility}`,
  ).get(authorId) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(Math.floor(options.page || 1), 1), totalPages);
  const rows = db.prepare(
    `SELECT c.id, c.article_id, c.author_id, u.display_name AS author_name,
            u.avatar_path AS author_avatar_path,
            c.body_markdown, c.status, c.created_at, c.updated_at,
            a.slug AS article_slug, a.title AS article_title
     FROM original_comments c
     JOIN users u ON u.id = c.author_id
     JOIN original_articles a ON a.id = c.article_id
     WHERE c.author_id = ? ${visibility}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ? OFFSET ?`,
  ).all(authorId, pageSize, (page - 1) * pageSize) as Array<{
    id: number;
    article_id: number;
    author_id: number;
    author_name: string;
    author_avatar_path: string | null;
    body_markdown: string;
    status: "published" | "hidden";
    created_at: string;
    updated_at: string;
    article_slug: string;
    article_title: string;
  }>;
  return {
    items: rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatarPath: row.author_avatar_path || null,
      bodyMarkdown: row.body_markdown,
      status: row.status === "hidden" ? "hidden" : "published",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      articleSlug: row.article_slug,
      articleTitle: row.article_title,
    })),
    page,
    pageSize,
    totalItems,
    totalPages,
  };
}

function commentQuotaFromUsage(role: string, trustLevel: number, usedToday: number): OriginalCommentQuota {
  if (role === "admin") {
    return { freeLimit: null, usedToday, remainingFree: null, nextCommentCost: 0 };
  }
  const settings = getOriginalPublishingSettings();
  const freeLimit = Math.max(Math.floor(trustLevel || 1), 1) * settings.freeCommentsPerLevel;
  const remainingFree = Math.max(freeLimit - usedToday, 0);
  return { freeLimit, usedToday, remainingFree, nextCommentCost: remainingFree > 0 ? 0 : settings.commentCostSoda };
}

export function getOriginalCommentQuota(user: Pick<UserProfile, "id" | "role" | "trustLevel">): OriginalCommentQuota {
  const row = getDb().prepare(
    "SELECT used_count FROM original_comment_daily_usage WHERE user_id = ? AND usage_date = ?",
  ).get(user.id, getSiteDateKey()) as { used_count: number } | undefined;
  const usedToday = row?.used_count || 0;
  return commentQuotaFromUsage(user.role, user.trustLevel, usedToday);
}

export function isOriginalAuthorBlocked(userId: number, authorId: number): boolean {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(authorId) || authorId <= 0) return false;
  return Boolean(getDb().prepare(
    "SELECT 1 AS found FROM user_original_author_blocks WHERE user_id = ? AND author_id = ?",
  ).get(userId, authorId));
}

export function setOriginalAuthorBlocked(userId: number, authorId: number, blocked: boolean): boolean {
  if (
    !Number.isSafeInteger(userId) || userId <= 0 ||
    !Number.isSafeInteger(authorId) || authorId <= 0 ||
    userId === authorId
  ) return false;
  const db = getDb();
  if (!blocked) {
    return db.prepare(
      "DELETE FROM user_original_author_blocks WHERE user_id = ? AND author_id = ?",
    ).run(userId, authorId).changes > 0;
  }
  return db.prepare(
    `INSERT OR IGNORE INTO user_original_author_blocks (user_id, author_id)
     SELECT ?, ?
     WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')
       AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`,
  ).run(userId, authorId, userId, authorId).changes > 0;
}

export function listBlockedOriginalAuthors(userId: number): OriginalBlockedAuthor[] {
  if (!Number.isSafeInteger(userId) || userId <= 0) return [];
  return (getDb().prepare(
    `SELECT b.author_id, u.display_name, u.avatar_path, u.trust_level, b.created_at,
            COUNT(a.id) AS article_count
     FROM user_original_author_blocks b
     JOIN users u ON u.id = b.author_id
     LEFT JOIN original_articles a ON a.author_id = b.author_id AND a.status = 'published'
     WHERE b.user_id = ?
     GROUP BY b.author_id, u.display_name, u.avatar_path, u.trust_level, b.created_at
     ORDER BY b.created_at DESC, b.author_id DESC
     LIMIT 200`,
  ).all(userId) as Array<{
    author_id: number;
    display_name: string;
    avatar_path: string | null;
    trust_level: number;
    article_count: number;
    created_at: string;
  }>).map((row) => ({
    authorId: row.author_id,
    displayName: row.display_name,
    avatarPath: row.avatar_path || null,
    trustLevel: Math.max(Math.floor(row.trust_level || 0), 0),
    articleCount: Math.max(Math.floor(row.article_count || 0), 0),
    blockedAt: row.created_at,
  }));
}

export function hasOriginalPurchase(articleId: number, userId: number): boolean {
  return Boolean(getDb().prepare("SELECT 1 AS found FROM original_purchases WHERE article_id = ? AND buyer_id = ?").get(articleId, userId));
}

export function getOriginalAccess(article: OriginalArticle, user: Pick<UserProfile, "id" | "role"> | null): OriginalAccess {
  if (article.status !== "published") {
    return { allowed: Boolean(user?.role === "admin" || user?.id === article.authorId), purchased: false, reason: "hidden" };
  }
  if (!user) {
    return { allowed: article.accessMode === "free", purchased: false, reason: article.accessMode === "free" ? "public" : "login" };
  }
  if (user.role === "admin" || user.id === article.authorId) {
    return { allowed: true, purchased: false, reason: "public" };
  }
  const purchased = hasOriginalPurchase(article.id, user.id);
  if (article.accessMode === "free") return { allowed: true, purchased, reason: "public" };
  if (purchased) return { allowed: true, purchased, reason: "purchase" };
  return { allowed: false, purchased, reason: "purchase" };
}

export function canPublishOriginal(user: Pick<UserProfile, "id" | "role" | "status" | "trustLevel" | "sodaBalance" | "cookieBalance"> | null): boolean {
  if (!canAccessOriginalChannel(true) || !user || user.status !== "active") return false;
  if (user.role === "admin") return true;
  const settings = getOriginalPublishingSettings();
  const equivalentSoda = user.sodaBalance + user.cookieBalance * getCookieToSodaRate();
  return user.trustLevel >= settings.minLevel || equivalentSoda >= settings.minSoda;
}

export function originalPublishRequirement(): string {
  const settings = getOriginalPublishingSettings();
  return `余额达到 ${settings.minSoda} 苏打或等级达到 Lv.${settings.minLevel}`;
}

function chargeSodaInTransaction(
  db: DatabaseSync,
  userId: number,
  amount: number,
  source: string,
  referenceKey: string,
  note: string,
): number {
  const fee = Math.max(Math.floor(amount), 0);
  if (!fee) {
    const row = db.prepare("SELECT soda_balance FROM users WHERE id = ?").get(userId) as { soda_balance: number } | undefined;
    if (!row) throw new OriginalInputError("用户不可用");
    return row.soda_balance;
  }
  const row = db.prepare("SELECT status, soda_balance FROM users WHERE id = ?").get(userId) as { status: string; soda_balance: number } | undefined;
  if (!row || row.status !== "active") throw new OriginalInputError("用户不可用");
  const balance = Math.floor(row.soda_balance || 0) - fee;
  if (balance < 0) throw new OriginalInputError("苏打余额不足，请先兑换或签到");
  db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(balance, userId);
  db.prepare(
    `INSERT INTO user_currency_transactions (user_id, currency, amount, balance_after, source, reference_key, note)
     VALUES (?, 'soda', ?, ?, ?, ?, ?)`,
  ).run(userId, -fee, balance, source, referenceKey, note.slice(0, 240));
  return balance;
}

function consumeOriginalCommentQuotaInTransaction(
  db: DatabaseSync,
  user: { id: number; role: string; trustLevel: number },
  note: string,
): OriginalCommentMutationResult {
  const usageDate = getSiteDateKey();
  const usage = db.prepare(
    "SELECT used_count FROM original_comment_daily_usage WHERE user_id = ? AND usage_date = ?",
  ).get(user.id, usageDate) as { used_count: number } | undefined;
  const quota = commentQuotaFromUsage(user.role, user.trustLevel, usage?.used_count || 0);
  const chargedSoda = quota.nextCommentCost;
  if (chargedSoda > 0) {
    chargeSodaInTransaction(
      db,
      user.id,
      chargedSoda,
      "original_comment",
      `original-comment:${user.id}:${crypto.randomUUID()}`,
      note,
    );
  }
  db.prepare(
    `INSERT INTO original_comment_daily_usage (user_id, usage_date, used_count)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id, usage_date) DO UPDATE SET
       used_count = used_count + 1,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(user.id, usageDate);
  return {
    chargedSoda,
    remainingFree: quota.remainingFree === null ? null : Math.max(quota.remainingFree - 1, 0),
  };
}

function linkTagsInTransaction(db: DatabaseSync, articleId: number, names: string[], createdBy: number) {
  db.prepare("DELETE FROM original_article_tags WHERE article_id = ?").run(articleId);
  for (const name of names) {
    const slug = tagSlug(name);
    db.prepare("INSERT OR IGNORE INTO original_tags (slug, name, created_by) VALUES (?, ?, ?)").run(slug, name, createdBy);
    const tag = db.prepare("SELECT id FROM original_tags WHERE slug = ?").get(slug) as { id: number };
    db.prepare("INSERT OR IGNORE INTO original_article_tags (article_id, tag_id) VALUES (?, ?)").run(articleId, tag.id);
  }
}

export function createOriginalArticle(input: {
  author: Pick<UserProfile, "id" | "role" | "status" | "trustLevel" | "sodaBalance" | "cookieBalance">;
  title: unknown;
  bodyMarkdown: unknown;
  excerpt?: unknown;
  /** Retained for callers of the pre-price-only API; price remains authoritative. */
  accessMode?: unknown;
  unlockSodaPrice?: unknown;
  tags?: unknown;
}): OriginalArticle {
  const title = cleanText(input.title, MAX_TITLE_LENGTH);
  if (title.length < 2) throw new OriginalInputError("标题至少需要 2 个字符");
  if (!canAccessOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  if (!canPublishOriginal(input.author)) throw new OriginalInputError(originalPublishRequirement());
  const settings = getOriginalPublishingSettings();
  const price = Math.min(Math.max(Math.floor(Number(input.unlockSodaPrice) || 0), 0), settings.maxArticlePrice);
  const accessMode: OriginalAccessMode = price > 0 ? "paid" : "free";
  const { publicBody, paidBody } = splitArticleBody(input.bodyMarkdown, price);
  const wordCount = countOriginalWords(`${publicBody}${paidBody}`);
  if (wordCount < settings.articleMinWords) throw new OriginalInputError(`文章至少需要 ${settings.articleMinWords} 字`);
  const excerpt = cleanText(input.excerpt, MAX_EXCERPT_LENGTH) || excerptFromBody(publicBody);
  const tags = normalizeTagNames(input.tags, settings.maxTags);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    chargeSodaInTransaction(db, input.author.id, settings.publishFeeSoda, "original_publish", `original-publish:${input.author.id}:${crypto.randomUUID()}`, "发布原创文章");
    const slug = uniqueSlug(db, title);
    const result = db.prepare(
      `INSERT INTO original_articles
         (slug, author_id, title, excerpt, body_markdown, paid_body_markdown, word_count, access_mode, unlock_soda_price, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', CURRENT_TIMESTAMP)`,
    ).run(slug, input.author.id, title, excerpt, publicBody, paidBody, wordCount, accessMode, price);
    const id = Number(result.lastInsertRowid);
    linkTagsInTransaction(db, id, tags, input.author.id);
    db.exec("COMMIT");
    return getOriginalArticleBySlug(slug, { includeUnpublished: true })!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type OriginalArticleUpdateInput = {
  articleId: number;
  title: unknown;
  bodyMarkdown: unknown;
  excerpt?: unknown;
  accessMode?: unknown;
  unlockSodaPrice?: unknown;
  tags?: unknown;
};

function updateOriginalArticleRecord(
  input: OriginalArticleUpdateInput,
  editor: { id: number; role: "user" | "admin"; status: "active" | "disabled" | "pending" },
  options: { requireChannel: boolean; chargeFee: boolean; enforceContentRules: boolean },
): OriginalArticle {
  if (options.requireChannel && !canAccessOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  if (!Number.isSafeInteger(input.articleId) || input.articleId <= 0) {
    throw new OriginalInputError("文章不存在");
  }
  const title = cleanText(input.title, MAX_TITLE_LENGTH);
  if (title.length < 2) throw new OriginalInputError("标题至少需要 2 个字符");
  const settings = getOriginalPublishingSettings();
  const price = Math.min(Math.max(Math.floor(Number(input.unlockSodaPrice) || 0), 0), settings.maxArticlePrice);
  const accessMode: OriginalAccessMode = price > 0 ? "paid" : "free";
  const { publicBody, paidBody } = splitArticleBody(input.bodyMarkdown, price);
  const wordCount = countOriginalWords(`${publicBody}${paidBody}`);
  if (options.enforceContentRules && wordCount < settings.articleMinWords) {
    throw new OriginalInputError(`文章至少需要 ${settings.articleMinWords} 字`);
  }
  const tags = normalizeTagNames(input.tags, settings.maxTags);
  const excerpt = cleanText(input.excerpt, MAX_EXCERPT_LENGTH) || excerptFromBody(publicBody);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT * FROM original_articles WHERE id = ?").get(input.articleId) as (ArticleRow & { author_id: number }) | undefined;
    if (!current) throw new OriginalInputError("文章不存在");
    if (editor.status !== "active" || (editor.role !== "admin" && current.author_id !== editor.id)) {
      throw new OriginalInputError("没有编辑权限");
    }
    if (options.chargeFee && editor.role !== "admin") {
      chargeSodaInTransaction(db, editor.id, settings.editFeeSoda, "original_edit", `original-edit:${input.articleId}:${editor.id}:${crypto.randomUUID()}`, "编辑原创文章");
    }
    db.prepare(
      `UPDATE original_articles
       SET title = ?, excerpt = ?, body_markdown = ?, paid_body_markdown = ?, word_count = ?, access_mode = ?, unlock_soda_price = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(title, excerpt, publicBody, paidBody, wordCount, accessMode, price, input.articleId);
    linkTagsInTransaction(db, input.articleId, tags, current.author_id);
    db.exec("COMMIT");
    return getOriginalArticleBySlug(current.slug, { includeUnpublished: true })!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateOriginalArticle(input: OriginalArticleUpdateInput & {
  author: Pick<UserProfile, "id" | "role" | "status">;
}): OriginalArticle {
  return updateOriginalArticleRecord(input, input.author, { requireChannel: true, chargeFee: true, enforceContentRules: true });
}

/** Admin edits stay available while the public channel is paused. */
export function updateOriginalArticleAsAdmin(input: OriginalArticleUpdateInput): OriginalArticle {
  return updateOriginalArticleRecord(input, { id: 0, role: "admin", status: "active" }, { requireChannel: false, chargeFee: false, enforceContentRules: false });
}

export function purchaseOriginalArticle(articleId: number, buyerId: number): { purchased: boolean; price: number } {
  if (!canConsumeOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  if (!Number.isSafeInteger(articleId) || articleId <= 0 || !Number.isSafeInteger(buyerId) || buyerId <= 0) {
    throw new OriginalInputError("文章不存在或暂不可见");
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const article = db.prepare(
      `SELECT id, author_id, access_mode, unlock_soda_price, status FROM original_articles WHERE id = ?`,
    ).get(articleId) as { id: number; author_id: number; access_mode: string; unlock_soda_price: number; status: OriginalArticleStatus } | undefined;
    if (!article || article.status !== "published") throw new OriginalInputError("文章不存在或暂不可见");
    if (article.author_id === buyerId) throw new OriginalInputError("作者无需购买自己的文章");
    const price = Math.max(Math.floor(article.unlock_soda_price || 0), 0);
    if (price <= 0) {
      db.exec("COMMIT");
      return { purchased: false, price: 0 };
    }
    if (db.prepare("SELECT 1 AS found FROM original_purchases WHERE article_id = ? AND buyer_id = ?").get(articleId, buyerId)) {
      db.exec("COMMIT");
      return { purchased: true, price };
    }
    const buyer = db.prepare("SELECT status, soda_balance FROM users WHERE id = ?").get(buyerId) as { status: string; soda_balance: number } | undefined;
    const author = db.prepare("SELECT status, soda_balance FROM users WHERE id = ?").get(article.author_id) as { status: string; soda_balance: number } | undefined;
    if (!buyer || buyer.status !== "active" || !author || author.status !== "active") throw new OriginalInputError("用户不可用");
    const buyerBalance = Math.floor(buyer.soda_balance || 0) - price;
    if (buyerBalance < 0) throw new OriginalInputError("苏打不足，无法解锁");
    const authorBalance = Math.floor(author.soda_balance || 0) + price;
    const reference = `original-purchase:${articleId}:${buyerId}`;
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(buyerBalance, buyerId);
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(authorBalance, article.author_id);
    db.prepare(
      `INSERT INTO original_purchases (article_id, buyer_id, author_id, price_soda, reference_key)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(articleId, buyerId, article.author_id, price, reference);
    db.prepare(
      `INSERT INTO user_currency_transactions (user_id, currency, amount, balance_after, source, reference_key, note)
       VALUES (?, 'soda', ?, ?, 'original_purchase', ?, ?)`,
    ).run(buyerId, -price, buyerBalance, `${reference}:buyer`, `解锁原创文章 #${articleId}`);
    db.prepare(
      `INSERT INTO user_currency_transactions (user_id, currency, amount, balance_after, source, reference_key, note)
       VALUES (?, 'soda', ?, ?, 'original_sale', ?, ?)`,
    ).run(article.author_id, price, authorBalance, `${reference}:author`, `原创文章 #${articleId} 收益`);
    db.exec("COMMIT");
    return { purchased: true, price };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Transfer one soda from the reader to the article author. Each invocation is
 * an intentional tip and is recorded on both balances in one transaction. */
export function tipOriginalAuthor(articleId: number, senderId: number): { amount: 1; balance: number; authorId: number } {
  if (!canConsumeOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  if (!Number.isSafeInteger(articleId) || articleId <= 0 || !Number.isSafeInteger(senderId) || senderId <= 0) {
    throw new OriginalInputError("文章不存在或暂不可见");
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const article = db.prepare(
      "SELECT author_id, title FROM original_articles WHERE id = ? AND status = 'published'",
    ).get(articleId) as { author_id: number; title: string } | undefined;
    if (!article) throw new OriginalInputError("文章不存在或暂不可见");
    if (article.author_id === senderId) throw new OriginalInputError("不能打赏自己的文章");
    const sender = db.prepare(
      "SELECT status, soda_balance FROM users WHERE id = ?",
    ).get(senderId) as { status: string; soda_balance: number } | undefined;
    const author = db.prepare(
      "SELECT status, soda_balance FROM users WHERE id = ?",
    ).get(article.author_id) as { status: string; soda_balance: number } | undefined;
    if (!sender || sender.status !== "active" || !author || author.status !== "active") {
      throw new OriginalInputError("用户不可用");
    }
    const senderBalance = Math.floor(sender.soda_balance || 0) - 1;
    if (senderBalance < 0) throw new OriginalInputError("苏打不足，无法打赏");
    const authorBalance = Math.floor(author.soda_balance || 0) + 1;
    const reference = `original-tip:${articleId}:${senderId}:${crypto.randomUUID()}`;
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(senderBalance, senderId);
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(authorBalance, article.author_id);
    db.prepare(
      `INSERT INTO user_currency_transactions
         (user_id, currency, amount, balance_after, source, reference_key, note)
       VALUES (?, 'soda', -1, ?, 'original_tip', ?, ?)`,
    ).run(senderId, senderBalance, `${reference}:sender`, `打赏原创文章《${article.title.slice(0, 80)}》`);
    db.prepare(
      `INSERT INTO user_currency_transactions
         (user_id, currency, amount, balance_after, source, reference_key, note)
       VALUES (?, 'soda', 1, ?, 'original_tip_income', ?, ?)`,
    ).run(article.author_id, authorBalance, `${reference}:author`, `原创文章《${article.title.slice(0, 80)}》收到打赏`);
    db.exec("COMMIT");
    return { amount: 1, balance: senderBalance, authorId: article.author_id };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function addOriginalComment(
  articleId: number,
  author: Pick<UserProfile, "id" | "role" | "trustLevel"> | number,
  bodyValue: unknown,
): OriginalCommentSubmitResult {
  if (!canConsumeOriginalChannel(true)) throw new OriginalInputError("原创频道暂未开放");
  const authorId = typeof author === "number" ? author : author.id;
  if (!Number.isSafeInteger(articleId) || articleId <= 0 || !Number.isSafeInteger(authorId) || authorId <= 0) {
    throw new OriginalInputError("文章不存在或暂不可见");
  }
  const body = cleanText(bodyValue, MAX_ORIGINAL_COMMENT_LENGTH);
  if (!body) throw new OriginalInputError("评论内容不能为空");
  const commentMinChars = getOriginalPublishingSettings().commentMinChars;
  if (countOriginalWords(body) < commentMinChars) throw new OriginalInputError(`评论至少需要 ${commentMinChars} 个字符`);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const article = db.prepare("SELECT status FROM original_articles WHERE id = ?").get(articleId) as { status: string } | undefined;
    const user = db.prepare(
      "SELECT status, role, trust_level, display_name, avatar_path FROM users WHERE id = ?",
    ).get(authorId) as { status: string; role: string; trust_level: number; display_name: string; avatar_path: string | null } | undefined;
    if (!article || article.status !== "published") throw new OriginalInputError("文章不存在或暂不可见");
    if (!user || user.status !== "active") throw new OriginalInputError("用户不可用");
    const mutation = consumeOriginalCommentQuotaInTransaction(
      db,
      { id: authorId, role: user.role, trustLevel: user.trust_level },
      `回复原创文章 #${articleId}`,
    );
    const result = db.prepare("INSERT INTO original_comments (article_id, author_id, body_markdown) VALUES (?, ?, ?)").run(articleId, authorId, body);
    const id = Number(result.lastInsertRowid);
    db.exec("COMMIT");
    const comment: OriginalComment = {
        id,
        articleId,
        authorId,
        authorName: user.display_name,
        authorAvatarPath: user.avatar_path || null,
        bodyMarkdown: body,
        status: "published",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    return {
      ...comment,
      comment,
      chargedSoda: mutation.chargedSoda,
      remainingFree: mutation.remainingFree,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setOriginalArticleStatus(articleId: number, status: OriginalArticleStatus): boolean {
  const normalized = normalizeStatus(status);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) return false;
  return getDb().prepare(
    `UPDATE original_articles
     SET status = ?,
         published_at = CASE
           WHEN ? = 'published' AND status <> 'published' THEN CURRENT_TIMESTAMP
           WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP
           ELSE published_at
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(normalized, normalized, normalized, articleId).changes > 0;
}

/** Reply creation, editing and deletion intentionally share one daily quota. */
export function updateOriginalComment(commentId: number, authorId: number, bodyValue: unknown): OriginalCommentUpdateResult {
  if (!Number.isSafeInteger(commentId) || commentId <= 0 || !Number.isSafeInteger(authorId) || authorId <= 0) {
    throw new OriginalInputError("回复不存在");
  }
  const body = cleanText(bodyValue, MAX_ORIGINAL_COMMENT_LENGTH);
  if (!body) throw new OriginalInputError("评论内容不能为空");
  const commentMinChars = getOriginalPublishingSettings().commentMinChars;
  if (countOriginalWords(body) < commentMinChars) throw new OriginalInputError(`评论至少需要 ${commentMinChars} 个字符`);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      `SELECT c.id, c.article_id, c.author_id, u.display_name AS author_name,
              u.avatar_path AS author_avatar_path, u.status AS user_status,
              u.role AS user_role, u.trust_level, c.status, c.created_at
       FROM original_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.id = ? AND c.author_id = ?`,
    ).get(commentId, authorId) as {
      id: number; article_id: number; author_id: number; author_name: string;
      author_avatar_path: string | null; user_status: string; user_role: string;
      trust_level: number; status: "published" | "hidden"; created_at: string;
    } | undefined;
    if (!row || row.user_status !== "active") throw new OriginalInputError("回复不存在或没有编辑权限");
    const mutation = consumeOriginalCommentQuotaInTransaction(
      db,
      { id: authorId, role: row.user_role, trustLevel: row.trust_level },
      `编辑原创回复 #${commentId}`,
    );
    db.prepare(
      `UPDATE original_comments
       SET body_markdown = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(body, commentId);
    const updated = db.prepare("SELECT updated_at FROM original_comments WHERE id = ?").get(commentId) as { updated_at: string };
    db.exec("COMMIT");
    return {
      id: row.id,
      articleId: row.article_id,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatarPath: row.author_avatar_path || null,
      bodyMarkdown: body,
      status: row.status === "hidden" ? "hidden" : "published",
      createdAt: row.created_at,
      updatedAt: updated.updated_at,
      ...mutation,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Delete a user's own reply; the database trigger keeps comment counts in sync. */
export function deleteOriginalComment(commentId: number, authorId: number): OriginalCommentMutationResult | null {
  if (!Number.isSafeInteger(commentId) || commentId <= 0 || !Number.isSafeInteger(authorId) || authorId <= 0) return null;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      `SELECT u.status AS user_status, u.role AS user_role, u.trust_level
       FROM original_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.id = ? AND c.author_id = ?`,
    ).get(commentId, authorId) as { user_status: string; user_role: string; trust_level: number } | undefined;
    if (!row || row.user_status !== "active") {
      db.exec("ROLLBACK");
      return null;
    }
    const mutation = consumeOriginalCommentQuotaInTransaction(
      db,
      { id: authorId, role: row.user_role, trustLevel: row.trust_level },
      `删除原创回复 #${commentId}`,
    );
    db.prepare("DELETE FROM original_comments WHERE id = ? AND author_id = ?").run(commentId, authorId);
    db.exec("COMMIT");
    return mutation;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function safeIdList(ids: number[]): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))).slice(0, 200);
}

/** Admin batch removal for selected articles. Cascades tags, purchases and history. */
export function deleteOriginalArticles(ids: number[]): number {
  const normalized = safeIdList(ids);
  if (!normalized.length) return 0;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const deleted = Number(db.prepare(`DELETE FROM original_articles WHERE id IN (${normalized.map(() => "?").join(",")})`).run(...normalized).changes);
    db.exec("COMMIT");
    return deleted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Admin batch removal for selected replies. */
export function deleteOriginalComments(ids: number[]): number {
  const normalized = safeIdList(ids);
  if (!normalized.length) return 0;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const deleted = Number(db.prepare(`DELETE FROM original_comments WHERE id IN (${normalized.map(() => "?").join(",")})`).run(...normalized).changes);
    db.exec("COMMIT");
    return deleted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Admin-only presentation state. Visibility and paid access remain governed
 * by the article status and price; pinning only raises published list rows. */
export function setOriginalArticlePinned(articleId: number, pinned: boolean): boolean {
  if (!Number.isSafeInteger(articleId) || articleId <= 0) return false;
  const value = pinned ? 1 : 0;
  return getDb().prepare(
    `UPDATE original_articles
     SET is_pinned = ?,
         pinned_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND is_pinned <> ?
       AND (? = 0 OR status = 'published')`,
  ).run(value, value, articleId, value, value).changes > 0;
}

export function setOriginalCommentStatus(commentId: number, status: "published" | "hidden"): boolean {
  const normalized = status === "hidden" ? "hidden" : "published";
  if (!Number.isSafeInteger(commentId) || commentId <= 0) return false;
  return getDb().prepare(
    "UPDATE original_comments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(normalized, commentId).changes > 0;
}
