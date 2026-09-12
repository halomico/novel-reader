import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import {
  hashMutationPayload,
  MutationIdError,
  normalizeMutationId,
  normalizeMutationTarget,
} from "@/core/mutations/mutation-contract";
import { runPostgresIdempotentMutation } from "@/core/mutations/postgres-idempotency";
import { originalAssetRoot } from "@/domains/originals/asset-storage";
import { createPostgresOriginalSearchFields } from "@/domains/originals/postgres-original-index";
import type { PostgresUserProfile } from "@/domains/identity/postgres-users";
import {
  getCookieToSodaRate,
  getOriginalPublishingSettings,
  isBidirectionalCurrencyExchangeEnabled,
} from "@/lib/config";
import { isValidOriginalTagName, normalizeOriginalTagName, originalTagSlug } from "@/lib/original-constants";
import {
  markdownForImport,
  serializeOriginalEditorState,
  type OriginalOutlineItem,
} from "./serialization";

export type OriginalDraft = {
  id: number;
  articleId: number | null;
  authorId: number;
  clientKey: string;
  title: string;
  editorStateJson: string;
  /** The published article's markdown, offered to the editor only until the draft has an
   *  editor state of its own. Empty for a draft that has been saved, or a new article. */
  importedMarkdown: string;
  tagIds: number[];
  unlockSodaPrice: number;
  revision: number;
  contentHash: string;
  autosavedAt: number;
  updatedAt: number;
};

export type SaveDraftInput = {
  draftId: number;
  authorId: number;
  revision: number;
  title: string;
  editorStateJson: string;
  tagIds: number[];
  unlockSodaPrice: number;
  contentHash?: string;
};

export type SaveDraftResult =
  | { ok: true; draft: OriginalDraft }
  | { ok: false; conflict: true; draft: OriginalDraft };

export type PublishDraftResult = {
  articleId: number;
  slug: string;
  created: boolean;
  revisionNo: number;
};

export type OriginalEditorTag = { id: number; name: string };

type DraftRow = QueryResultRow & {
  id: string | number;
  article_id: string | number | null;
  author_id: string | number;
  client_key: string;
  title: string;
  editor_state_json: string;
  /** Joined from the article this draft edits, so the editor can start from what was
   *  published without the draft carrying a copy that goes stale. */
  body_markdown: string | null;
  paid_body_markdown: string | null;
  tags_json: unknown;
  unlock_soda_price: string | number;
  revision: string | number;
  content_hash: string;
  autosaved_at: Date | string;
  updated_at: Date | string;
};

type PublishingUserRow = QueryResultRow & {
  id: string | number;
  status: string;
  trust_level: string | number;
  soda_balance: string | number;
  cookie_balance: string | number;
};

const MAX_TITLE_LENGTH = 100;
const MAX_DRAFT_JSON_BYTES = 4 * 1024 * 1024;
const MAX_TAGS = 12;

export class OriginalDraftError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "forbidden" | "not_found" | "conflict" | "insufficient_balance" | "unavailable",
  ) {
    super(message);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string, label: string): number {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed.getTime();
}

function cleanTitle(value: string): string {
  const title = value.normalize("NFKC").trim();
  if (!title) throw new OriginalDraftError("请输入文章标题", "invalid");
  if (Array.from(title).length > MAX_TITLE_LENGTH) {
    throw new OriginalDraftError(`标题最多 ${MAX_TITLE_LENGTH} 个字`, "invalid");
  }
  return title;
}

function cleanTagIds(values: readonly number[]): number[] {
  return [...new Set(values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, MAX_TAGS);
}

function cleanAssetIds(values: readonly number[]): number[] {
  return [...new Set(values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function hashDraft(title: string, editorStateJson: string, tagIds: readonly number[], price: number): string {
  return crypto.createHash("sha256")
    .update(title).update("\0")
    .update(editorStateJson).update("\0")
    .update(JSON.stringify(tagIds)).update("\0")
    .update(String(price))
    .digest("hex");
}

function draftTagIds(value: unknown): number[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
    return Array.isArray(parsed) ? cleanTagIds(parsed.map(Number)) : [];
  } catch {
    return [];
  }
}

/** Every draft read, with the edited article's markdown alongside it. `FOR UPDATE OF d`
 *  because PostgreSQL will not lock the nullable side of an outer join. */
const DRAFT_SELECT = `SELECT d.id, d.article_id, d.author_id, d.client_key, d.title, d.editor_state_json,
      a.body_markdown, a.paid_body_markdown, d.tags_json, d.unlock_soda_price,
      d.revision, d.content_hash, d.autosaved_at, d.updated_at
    FROM original_article_drafts d
    LEFT JOIN original_articles a ON a.id = d.article_id`;

/** Columns a write returns; it works on the draft alone, and a draft that has just been
 *  written has an editor state, which is what the editor loads in preference anyway. */
const DRAFT_RETURNING = `id, article_id, author_id, client_key, title, editor_state_json,
      NULL::text AS body_markdown, NULL::text AS paid_body_markdown, tags_json, unlock_soda_price,
      revision, content_hash, autosaved_at, updated_at`;

function toDraft(row: DraftRow): OriginalDraft {
  return {
    id: positiveInteger(row.id, "draft id"),
    articleId: row.article_id === null ? null : positiveInteger(row.article_id, "article id"),
    authorId: positiveInteger(row.author_id, "author id"),
    clientKey: row.client_key,
    title: row.title,
    editorStateJson: row.editor_state_json,
    importedMarkdown: row.editor_state_json
      ? ""
      : markdownForImport(row.body_markdown || "", row.paid_body_markdown || ""),
    tagIds: draftTagIds(row.tags_json),
    unlockSodaPrice: nonNegativeInteger(row.unlock_soda_price, "unlock price"),
    revision: positiveInteger(row.revision, "draft revision"),
    contentHash: row.content_hash,
    autosavedAt: timestamp(row.autosaved_at, "draft autosave time"),
    updatedAt: timestamp(row.updated_at, "draft update time"),
  };
}

async function selectDraft(
  executor: SqlExecutor,
  draftId: number,
  authorId: number,
  lock = false,
): Promise<OriginalDraft | null> {
  const result = await executor.query<DraftRow>({
    text: `${DRAFT_SELECT} WHERE d.id = $1 AND d.author_id = $2${lock ? " FOR UPDATE OF d" : ""}`,
    values: [draftId, authorId],
  });
  return result.rows[0] ? toDraft(result.rows[0]) : null;
}

export async function listOriginalEditorTags(
  options: { query?: string; limit?: number; ids?: number[] } = {},
): Promise<OriginalEditorTag[]> {
  const values: unknown[] = [];
  const filters: string[] = [];
  const query = String(options.query || "").normalize("NFKC").trim().slice(0, 40);
  if (query) {
    values.push(`%${query.replace(/[\\%_]/gu, "\\$&")}%`);
    filters.push(`name ILIKE $${values.length} ESCAPE '\\'`);
  }
  if (options.ids) {
    const ids = cleanTagIds(options.ids);
    if (!ids.length) return [];
    values.push(ids);
    filters.push(`id = ANY($${values.length}::bigint[])`);
  }
  const limit = Number.isFinite(options.limit) ? Math.min(Math.max(Math.floor(options.limit || 300), 1), 300) : 300;
  values.push(limit);
  const result = await database().query<QueryResultRow & { id: string | number; name: string }>({
    text: `SELECT id, name FROM original_tags ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY lower(name), id LIMIT $${values.length}`,
    values,
  });
  return result.rows.map((row) => ({ id: positiveInteger(row.id, "original tag id"), name: row.name }));
}

export function listOriginalEditorTagsByIds(ids: number[]): Promise<OriginalEditorTag[]> {
  return listOriginalEditorTags({ ids, limit: 12 });
}

export function searchOriginalEditorTags(query: string, limit = 8): Promise<OriginalEditorTag[]> {
  return listOriginalEditorTags({ query, limit });
}

function slugBase(title: string): string {
  const ascii = title.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 56);
  return ascii.length >= 3 ? ascii : `article-${Date.now().toString(36)}`;
}

async function uniqueSlug(executor: SqlExecutor, title: string, excludeArticleId = 0, maximumLength = 78): Promise<string> {
  const base = slugBase(title).slice(0, maximumLength);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const suffixText = suffix === 1 ? "" : `-${suffix}`;
    const candidate = `${base.slice(0, maximumLength - suffixText.length)}${suffixText}`;
    const found = await executor.query({
      text: "SELECT 1 FROM original_articles WHERE lower(slug) = lower($1) AND id <> $2",
      values: [candidate, excludeArticleId],
    });
    if (!found.rowCount) return candidate;
  }
  return `article-${crypto.randomBytes(8).toString("hex")}`;
}

export async function createOriginalEditorTag(input: { name: unknown; authorId: number }): Promise<OriginalEditorTag> {
  const name = normalizeOriginalTagName(input.name);
  if (!isValidOriginalTagName(name)) {
    throw new OriginalDraftError("中文标签需为 2–6 个汉字，英文标签需为 2–15 个字母且不能包含空格或符号", "invalid");
  }
  if (!Number.isSafeInteger(input.authorId) || input.authorId <= 0) {
    throw new OriginalDraftError("请先登录", "forbidden");
  }
  return withTransaction(async (tx) => {
    await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended('original-tags-create-v1', 0))" });
    const existing = await tx.query<QueryResultRow & { id: string | number; name: string }>({
      text: "SELECT id, name FROM original_tags WHERE lower(name) = lower($1) LIMIT 1",
      values: [name],
    });
    if (existing.rows[0]) {
      return { id: positiveInteger(existing.rows[0].id, "original tag id"), name: existing.rows[0].name };
    }
    const slug = await uniqueOriginalTagSlug(tx, name);
    const result = await tx.query<QueryResultRow & { id: string | number }>({
      text: "INSERT INTO original_tags (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id",
      values: [slug, name, input.authorId],
    });
    return { id: positiveInteger(result.rows[0]?.id, "original tag id"), name };
  });
}

async function uniqueOriginalTagSlug(executor: SqlExecutor, name: string): Promise<string> {
  const base = originalTagSlug(name);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const suffixText = suffix === 1 ? "" : `-${suffix}`;
    const candidate = `${base.slice(0, Math.max(1, 64 - suffixText.length))}${suffixText}`;
    const found = await executor.query({ text: "SELECT 1 FROM original_tags WHERE lower(slug) = lower($1)", values: [candidate] });
    if (!found.rowCount) return candidate;
  }
  return `tag-${crypto.randomBytes(8).toString("hex")}`;
}

export async function getOriginalDraftForAuthor(draftId: number, authorId: number): Promise<OriginalDraft | null> {
  if (!Number.isSafeInteger(draftId) || draftId <= 0 || !Number.isSafeInteger(authorId) || authorId <= 0) return null;
  return selectDraft(database(), draftId, authorId);
}

export async function listOriginalDraftsForAuthor(authorId: number, pageValue: number, pageSizeValue: number) {
  const pageSize = Math.min(Math.max(Math.floor(pageSizeValue) || 20, 1), 100);
  const requestedPage = Math.max(Math.floor(pageValue) || 1, 1);
  const result = await database().query<QueryResultRow & {
    id: string | number | null; title: string | null; updated_at: Date | string | null;
    total_items: string | number; total_pages: string | number; page: string | number;
  }>({
    text: `WITH metadata AS (
        SELECT COUNT(*)::bigint AS total_items,
          GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages
        FROM original_article_drafts WHERE author_id = $1 AND article_id IS NULL
      ), requested AS (
        SELECT total_items, total_pages, LEAST($2::bigint, total_pages) AS page FROM metadata
      )
      SELECT requested.*, draft.id, draft.title, draft.updated_at
      FROM requested LEFT JOIN LATERAL (
        SELECT id, title, updated_at FROM original_article_drafts
        WHERE author_id = $1 AND article_id IS NULL
        ORDER BY updated_at DESC, id DESC LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) draft ON TRUE`,
    values: [positiveInteger(authorId, "author id"), requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL original draft page metadata is missing");
  const totalItems = nonNegativeInteger(first.total_items, "draft total");
  return {
    items: totalItems ? result.rows.map((row) => ({
      id: positiveInteger(row.id, "draft id"),
      title: row.title || "",
      updatedAt: timestamp(row.updated_at!, "draft update time"),
    })) : [],
    page: positiveInteger(first.page, "draft page"),
    totalPages: positiveInteger(first.total_pages, "draft pages"),
  };
}

export async function deleteOriginalDraftForAuthor(draftId: number, authorId: number): Promise<boolean> {
  if (!Number.isSafeInteger(draftId) || draftId < 1 || !Number.isSafeInteger(authorId) || authorId < 1) return false;
  return (await deleteOriginalDraftsForAuthor([draftId], authorId)) === 1;
}

export async function deleteOriginalDraftsForAuthor(draftIds: readonly number[], authorId: number): Promise<number> {
  if (!Number.isSafeInteger(authorId) || authorId < 1) return 0;
  if (!Array.isArray(draftIds) || draftIds.length > 100 || draftIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new OriginalDraftError("草稿参数无效", "invalid");
  }
  const ids = [...new Set(draftIds)];
  if (!ids.length) return 0;
  const result = await database().query({
    text: `DELETE FROM original_article_drafts
      WHERE id = ANY($1::bigint[]) AND author_id = $2 AND article_id IS NULL`,
    values: [ids, authorId],
  });
  return nonNegativeInteger(result.rowCount ?? 0, "deleted draft count");
}

export async function createOrResumeOriginalDraft(input: {
  authorId: number;
  clientKey: string;
  articleSlug?: string;
}): Promise<OriginalDraft> {
  const authorId = Number(input.authorId);
  if (!Number.isSafeInteger(authorId) || authorId <= 0) throw new OriginalDraftError("请先登录", "forbidden");
  const clientKey = String(input.clientKey || "").trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/u.test(clientKey)) throw new OriginalDraftError("草稿标识无效", "invalid");
  return withTransaction(async (tx) => {
    const current = await tx.query<DraftRow>({
      text: `${DRAFT_SELECT} WHERE d.author_id = $1 AND d.client_key = $2 FOR UPDATE OF d`,
      values: [authorId, clientKey],
    });
    if (current.rows[0]) return toDraft(current.rows[0]);
    const article = input.articleSlug ? (await tx.query<QueryResultRow & {
      id: string | number; title: string; body_markdown: string; paid_body_markdown: string; unlock_soda_price: string | number;
    }>({
      text: `SELECT id, title, body_markdown, paid_body_markdown, unlock_soda_price
        FROM original_articles WHERE lower(slug) = lower($1) AND author_id = $2 LIMIT 1 FOR KEY SHARE`,
      values: [input.articleSlug, authorId],
    })).rows[0] : undefined;
    if (input.articleSlug && !article) throw new OriginalDraftError("文章不存在或无权编辑", "not_found");
    const articleId = article ? positiveInteger(article.id, "article id") : null;
    const tags = articleId ? await tx.query<QueryResultRow & { id: string | number }>({
      text: "SELECT tag_id AS id FROM original_article_tags WHERE article_id = $1 ORDER BY tag_id",
      values: [articleId],
    }) : null;
    const tagIds = tags ? tags.rows.map((row) => positiveInteger(row.id, "original tag id")) : [];
    const title = article?.title || "";
    const price = article ? nonNegativeInteger(article.unlock_soda_price, "unlock price") : 0;
    const contentHash = hashDraft(title, "", tagIds, price);
    const inserted = await tx.query<DraftRow>({
      text: `INSERT INTO original_article_drafts (
          article_id, author_id, client_key, title,
          tags_json, unlock_soda_price, revision, content_hash, autosaved_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1, $7,
          clock_timestamp(), clock_timestamp(), clock_timestamp())
        ON CONFLICT (author_id, client_key) DO NOTHING
        RETURNING ${DRAFT_RETURNING}`,
      values: [articleId, authorId, clientKey, title, JSON.stringify(tagIds), price, contentHash],
    });
    if (inserted.rows[0]) {
      return toDraft({
        ...inserted.rows[0],
        body_markdown: article?.body_markdown ?? null,
        paid_body_markdown: article?.paid_body_markdown ?? null,
      });
    }
    const existing = await tx.query<DraftRow>({
      text: `${DRAFT_SELECT} WHERE d.author_id = $1 AND d.client_key = $2`,
      values: [authorId, clientKey],
    });
    if (!existing.rows[0]) throw new Error("Draft conflict did not return the existing row");
    return toDraft(existing.rows[0]);
  });
}

export async function saveOriginalDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  if (Buffer.byteLength(input.editorStateJson, "utf8") > MAX_DRAFT_JSON_BYTES) {
    throw new OriginalDraftError("文章内容超过草稿保存上限", "invalid");
  }
  if (!Number.isSafeInteger(input.draftId) || input.draftId < 1 ||
      !Number.isSafeInteger(input.authorId) || input.authorId < 1 ||
      !Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new OriginalDraftError("草稿参数无效", "invalid");
  }
  const title = Array.from(input.title.normalize("NFKC").trim()).slice(0, MAX_TITLE_LENGTH).join("");
  const tagIds = cleanTagIds(input.tagIds);
  const price = Math.min(Math.max(Math.floor(input.unlockSodaPrice || 0), 0), 1_000_000);
  const contentHash = hashDraft(title, input.editorStateJson, tagIds, price);
  const executor = database();
  const changed = await executor.query<DraftRow>({
    text: `UPDATE original_article_drafts SET title = $4, editor_state_json = $5, tags_json = $6::jsonb,
      unlock_soda_price = $7, revision = revision + 1, content_hash = $8,
      autosaved_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE id = $1 AND author_id = $2 AND revision = $3
      RETURNING ${DRAFT_RETURNING}`,
    values: [input.draftId, input.authorId, input.revision, title, input.editorStateJson, JSON.stringify(tagIds), price, contentHash],
  });
  if (changed.rows[0]) return { ok: true, draft: toDraft(changed.rows[0]) };
  const draft = await selectDraft(executor, input.draftId, input.authorId);
  if (!draft) throw new OriginalDraftError("草稿不存在", "not_found");
  return { ok: false, conflict: true, draft };
}

async function updateBalancesForFee(
  tx: SqlExecutor,
  user: { id: number; sodaBalance: number; cookieBalance: number },
  fee: number,
  mutationId: string,
  source: "original_publish" | "original_edit",
): Promise<void> {
  if (fee <= 0) return;
  let soda = user.sodaBalance;
  let cookie = user.cookieBalance;
  if (soda < fee && isBidirectionalCurrencyExchangeEnabled()) {
    const rate = getCookieToSodaRate();
    const cookiesNeeded = Math.ceil((fee - soda) / rate);
    if (cookie >= cookiesNeeded) {
      cookie -= cookiesNeeded;
      const received = cookiesNeeded * rate;
      soda += received;
      await tx.query({
        text: "UPDATE users SET cookie_balance = $2, soda_balance = $3, updated_at = clock_timestamp() WHERE id = $1",
        values: [user.id, cookie, soda],
      });
      await tx.query({
        text: `INSERT INTO user_currency_transactions
          (user_id, currency, amount, balance_after, source, reference_key, note)
          VALUES ($1, 'cookie', $2, $3, 'exchange', $4, '原创发布费用自动兑换'),
                 ($1, 'soda', $5, $6, 'exchange', $7, '原创发布费用自动兑换')`,
        values: [user.id, -cookiesNeeded, cookie, `${mutationId}:auto-cookie`, received, soda, `${mutationId}:auto-soda`],
      });
    }
  }
  if (soda < fee) {
    throw new OriginalDraftError(`发布资格已满足，但还需要 ${fee - soda} 苏打支付费用`, "insufficient_balance");
  }
  soda -= fee;
  await tx.query({
    text: "UPDATE users SET soda_balance = $2, updated_at = clock_timestamp() WHERE id = $1",
    values: [user.id, soda],
  });
  await tx.query({
    text: `INSERT INTO user_currency_transactions
      (user_id, currency, amount, balance_after, source, reference_key, note)
      VALUES ($1, 'soda', $2, $3, $4, $5, $6)`,
    values: [
      user.id, -fee, soda, source, mutationId,
      source === "original_publish" ? "发布原创文章" : "编辑原创文章",
    ],
  });
}

async function replaceArticleTags(tx: SqlExecutor, articleId: number, values: readonly number[]): Promise<void> {
  const tagIds = cleanTagIds(values);
  if (tagIds.length) {
    const found = await tx.query({ text: "SELECT id FROM original_tags WHERE id = ANY($1::bigint[])", values: [tagIds] });
    if (found.rowCount !== tagIds.length) throw new OriginalDraftError("所选原创标签不存在", "invalid");
  }
  await tx.query({ text: "DELETE FROM original_article_tags WHERE article_id = $1", values: [articleId] });
  if (tagIds.length) {
    await tx.query({
      text: "INSERT INTO original_article_tags (article_id, tag_id) SELECT $1, tag_id FROM unnest($2::bigint[]) tag_id",
      values: [articleId, tagIds],
    });
  }
}

async function updateAssets(
  tx: SqlExecutor,
  ownerId: number,
  articleId: number,
  publicValues: readonly number[],
  paidValues: readonly number[],
): Promise<void> {
  const publicIds = cleanAssetIds(publicValues);
  const paidIds = cleanAssetIds(paidValues);
  const all = [...new Set([...publicIds, ...paidIds])];
  if (all.length) {
    const owned = await tx.query({
      text: "SELECT id FROM original_assets WHERE owner_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE",
      values: [ownerId, all],
    });
    if (owned.rowCount !== all.length) throw new OriginalDraftError("文章包含无权使用的图片", "forbidden");
  }
  await tx.query({
    text: `UPDATE original_assets SET article_id = NULL, access_scope = 'draft', updated_at = clock_timestamp()
      WHERE owner_id = $1 AND article_id = $2 AND NOT (id = ANY($3::bigint[]))`,
    values: [ownerId, articleId, all],
  });
  if (publicIds.length) {
    await tx.query({
      text: `UPDATE original_assets SET article_id = $2, access_scope = 'public', updated_at = clock_timestamp()
        WHERE owner_id = $1 AND id = ANY($3::bigint[])`,
      values: [ownerId, articleId, publicIds],
    });
  }
  if (paidIds.length) {
    await tx.query({
      text: `UPDATE original_assets SET article_id = $2, access_scope = 'paid', updated_at = clock_timestamp()
        WHERE owner_id = $1 AND id = ANY($3::bigint[])`,
      values: [ownerId, articleId, paidIds],
    });
  }
}

function publishContract(input: { draftId: number; authorId: number; expectedRevision: number; mutationId: string }) {
  try {
    return {
      mutationId: normalizeMutationId(input.mutationId),
      userId: input.authorId,
      operation: "original.publish",
      target: normalizeMutationTarget(`draft:${input.draftId}`),
      payloadHash: hashMutationPayload({ expectedRevision: input.expectedRevision }),
    };
  } catch (error) {
    if (error instanceof MutationIdError) throw new OriginalDraftError(error.message, "invalid");
    throw error;
  }
}

export async function publishOriginalDraft(input: {
  draftId: number;
  author: PostgresUserProfile;
  expectedRevision: number;
  mutationId: string;
}): Promise<PublishDraftResult> {
  const contract = publishContract({
    draftId: input.draftId,
    authorId: input.author.id,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
  });
  return runPostgresIdempotentMutation(contract, async (tx) => {
    const draft = await selectDraft(tx, input.draftId, input.author.id, true);
    if (!draft) throw new OriginalDraftError("草稿不存在", "not_found");
    if (draft.revision !== input.expectedRevision) {
      throw new OriginalDraftError("草稿已在其他页面更新，请先处理冲突", "conflict");
    }
    if (!draft.editorStateJson) throw new OriginalDraftError("正文不能为空", "invalid");
    const title = cleanTitle(draft.title);
    const document = serializeOriginalEditorState(draft.editorStateJson);
    const price = Math.max(0, Math.floor(draft.unlockSodaPrice || 0));
    if (!document.publicMarkdown || document.publicWordCount < 1) {
      throw new OriginalDraftError("公开部分正文不能为空", "invalid");
    }
    if (price > 0) {
      if (document.paidGateCount !== 1) throw new OriginalDraftError("付费文章必须且只能设置一个付费分界", "invalid");
      if (!document.paidMarkdown || document.paidWordCount < 1) throw new OriginalDraftError("付费分界后必须有正文", "invalid");
    } else if (document.paidGateCount > 0 || document.paidMarkdown) {
      throw new OriginalDraftError("免费文章不能包含付费分界", "invalid");
    }
    const settings = getOriginalPublishingSettings();
    const wordCount = document.publicWordCount + document.paidWordCount;
    if (input.author.role !== "admin" && wordCount < settings.articleMinWords) {
      throw new OriginalDraftError(`正文至少需要 ${settings.articleMinWords} 字才能发布`, "invalid");
    }
    if (document.publicMarkdown.length + document.paidMarkdown.length > settings.articleMaxChars) {
      throw new OriginalDraftError(`正文不能超过 ${settings.articleMaxChars.toLocaleString()} 字符`, "invalid");
    }
    const users = await tx.query<PublishingUserRow>({
      text: "SELECT id, status, trust_level, soda_balance, cookie_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      values: [input.author.id],
    });
    const user = users.rows[0];
    if (!user || user.status !== "active") throw new OriginalDraftError("账号不可用", "forbidden");
    const sodaBalance = nonNegativeInteger(user.soda_balance, "soda balance");
    const cookieBalance = nonNegativeInteger(user.cookie_balance, "cookie balance");
    const created = !draft.articleId;
    if (created) {
      const totalValue = sodaBalance + cookieBalance * getCookieToSodaRate();
      if (nonNegativeInteger(user.trust_level, "trust level") < settings.minLevel && totalValue < settings.minSoda) {
        throw new OriginalDraftError(`达到 Lv.${settings.minLevel} 或拥有足够资产后可发布`, "forbidden");
      }
    }
    await updateBalancesForFee(
      tx,
      { id: input.author.id, sodaBalance, cookieBalance },
      created ? settings.publishFeeSoda : settings.editFeeSoda,
      contract.mutationId,
      created ? "original_publish" : "original_edit",
    );

    await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended('original-article-slugs-v1', 0))" });
    let slug = "";
    if (draft.articleId) {
      const article = await tx.query<QueryResultRow & { slug: string }>({
        text: "SELECT slug FROM original_articles WHERE id = $1 AND author_id = $2 FOR UPDATE",
        values: [draft.articleId, input.author.id],
      });
      if (!article.rows[0]) throw new OriginalDraftError("文章不存在或无权编辑", "not_found");
      slug = article.rows[0].slug;
    } else {
      slug = await uniqueSlug(tx, title);
    }
    const excerpt = document.publicMarkdown
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/[#>*_`~\[\]()!-]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 180);
    const search = await createPostgresOriginalSearchFields(title, document.publicMarkdown);
    let articleId: number;
    if (draft.articleId) {
      const changed = await tx.query({
        text: `UPDATE original_articles SET title = $3, excerpt = $4, body_markdown = $5,
          paid_body_markdown = $6, word_count = $7, access_mode = $8, unlock_soda_price = $9,
          status = 'published', title_search_original = $10, title_search_hans = $11,
          content_search_original = $12, content_search_hans = $13, normalization_version = $14,
          published_at = COALESCE(published_at, clock_timestamp()), updated_at = clock_timestamp()
          WHERE id = $1 AND author_id = $2`,
        values: [
          draft.articleId, input.author.id, title, excerpt, document.publicMarkdown, document.paidMarkdown,
          wordCount, price > 0 ? "paid" : "free", price,
          search.titleSearchOriginal, search.titleSearchHans, search.contentSearchOriginal,
          search.contentSearchHans, search.normalizationVersion,
        ],
      });
      if (changed.rowCount !== 1) throw new OriginalDraftError("文章不存在或无权编辑", "not_found");
      articleId = draft.articleId;
    } else {
      const inserted = await tx.query<QueryResultRow & { id: string | number }>({
        text: `INSERT INTO original_articles (
          author_id, slug, title, excerpt, body_markdown, paid_body_markdown, word_count,
          access_mode, unlock_soda_price, status, published_at,
          title_search_original, title_search_hans, content_search_original, content_search_hans, normalization_version)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', clock_timestamp(),
            $10, $11, $12, $13, $14) RETURNING id`,
        values: [
          input.author.id, slug, title, excerpt, document.publicMarkdown, document.paidMarkdown,
          wordCount, price > 0 ? "paid" : "free", price,
          search.titleSearchOriginal, search.titleSearchHans, search.contentSearchOriginal,
          search.contentSearchHans, search.normalizationVersion,
        ],
      });
      articleId = positiveInteger(inserted.rows[0]?.id, "article id");
    }
    await replaceArticleTags(tx, articleId, draft.tagIds);
    await updateAssets(tx, input.author.id, articleId, document.publicAssetIds, document.paidAssetIds);
    const revision = await tx.query<QueryResultRow & { revision_no: string | number }>({
      text: "SELECT COALESCE(MAX(revision_no), 0) + 1 AS revision_no FROM original_article_revisions WHERE article_id = $1",
      values: [articleId],
    });
    const revisionNo = positiveInteger(revision.rows[0]?.revision_no, "article revision");
    await tx.query({
      text: `INSERT INTO original_article_revisions (
        article_id, revision_no, title, body_markdown, paid_body_markdown, outline_json, editor_state_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
      values: [
        articleId, revisionNo, title, document.publicMarkdown, document.paidMarkdown,
        JSON.stringify(document.outline satisfies OriginalOutlineItem[]), draft.editorStateJson,
      ],
    });
    await tx.query({
      text: `DELETE FROM original_article_revisions WHERE article_id = $1 AND id NOT IN (
        SELECT id FROM original_article_revisions WHERE article_id = $1 ORDER BY revision_no DESC LIMIT 20)`,
      values: [articleId],
    });
    // The published article and its revision are now the canonical copies. A future
    // edit starts a fresh working draft from the article, so the publish transaction
    // must not leave a duplicate draft row behind.
    await tx.query({
      text: "DELETE FROM original_article_drafts WHERE id = $1 AND author_id = $2",
      values: [draft.id, input.author.id],
    });
    return { articleId, slug, created, revisionNo };
  });
}

export async function storeOriginalAsset(input: {
  ownerId: number;
  bytes: Buffer;
  width: number;
  height: number;
  mimeType: string;
}): Promise<{ id: number; url: string; width: number; height: number }> {
  const ownerId = positiveInteger(input.ownerId, "asset owner id");
  if (!Buffer.isBuffer(input.bytes) || !input.bytes.length ||
      !Number.isSafeInteger(input.width) || input.width < 1 ||
      !Number.isSafeInteger(input.height) || input.height < 1) {
    throw new OriginalDraftError("图片数据无效", "invalid");
  }
  const root = originalAssetRoot();
  const ownerDir = path.join(root, String(ownerId));
  await fs.promises.mkdir(ownerDir, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomBytes(10).toString("hex")}.webp`;
  const target = path.join(ownerDir, fileName);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  await fs.promises.writeFile(temporary, input.bytes, { flag: "wx", mode: 0o600 });
  try {
    await fs.promises.rename(temporary, target);
    const storagePath = path.relative(root, target).replace(/\\/gu, "/");
    const result = await database().query<QueryResultRow & { id: string | number }>({
      text: `INSERT INTO original_assets (
        owner_id, file_name, storage_path, mime_type, width, height, size_bytes,
        access_scope, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', clock_timestamp(), clock_timestamp()) RETURNING id`,
      values: [ownerId, fileName, storagePath, input.mimeType, input.width, input.height, input.bytes.length],
    });
    const id = positiveInteger(result.rows[0]?.id, "original asset id");
    return { id, url: `/original/assets/${id}`, width: input.width, height: input.height };
  } catch (error) {
    await fs.promises.rm(target, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}
