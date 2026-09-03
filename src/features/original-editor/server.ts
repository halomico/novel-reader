import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { normalizeMutationId, readMutationReceipt, storeMutationReceipt } from "@/core/mutations/idempotency";
import {
  getCookieToSodaRate,
  getOriginalPublishingSettings,
  isBidirectionalCurrencyExchangeEnabled,
} from "@/lib/config";
import { getDb } from "@/lib/db";
import type { UserProfile } from "@/lib/users";
import {
  legacyMarkdownForImport,
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
  legacyMarkdown: string;
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

type DraftRow = {
  id: number;
  article_id: number | null;
  author_id: number;
  client_key: string;
  title: string;
  editor_state_json: string;
  legacy_public_markdown: string;
  legacy_paid_markdown: string;
  tags_json: string;
  unlock_soda_price: number;
  revision: number;
  content_hash: string;
  autosaved_at: number;
  updated_at: number;
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

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function tableColumns(db: DatabaseSync, name: string): Set<string> {
  if (!tableExists(db, name)) return new Set();
  return new Set((db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((row) => row.name));
}

function cleanTitle(value: string): string {
  const title = value.normalize("NFKC").trim();
  if (!title) throw new OriginalDraftError("请输入文章标题", "invalid");
  if (Array.from(title).length > MAX_TITLE_LENGTH) {
    throw new OriginalDraftError(`标题最多 ${MAX_TITLE_LENGTH} 个字`, "invalid");
  }
  return title;
}

function cleanTagIds(values: number[]): number[] {
  return [...new Set(values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, MAX_TAGS);
}

function hashDraft(title: string, editorStateJson: string, tagIds: number[], price: number): string {
  return crypto.createHash("sha256")
    .update(title).update("\0")
    .update(editorStateJson).update("\0")
    .update(JSON.stringify(tagIds)).update("\0")
    .update(String(price))
    .digest("hex");
}

function toDraft(row: DraftRow): OriginalDraft {
  let tagIds: number[] = [];
  try {
    const parsed = JSON.parse(row.tags_json) as unknown;
    if (Array.isArray(parsed)) tagIds = cleanTagIds(parsed.map(Number));
  } catch {
    tagIds = [];
  }
  return {
    id: row.id,
    articleId: row.article_id,
    authorId: row.author_id,
    clientKey: row.client_key,
    title: row.title,
    editorStateJson: row.editor_state_json,
    legacyMarkdown: legacyMarkdownForImport(row.legacy_public_markdown, row.legacy_paid_markdown),
    tagIds,
    unlockSodaPrice: Math.max(0, Math.floor(row.unlock_soda_price || 0)),
    revision: Math.max(1, Math.floor(row.revision || 1)),
    contentHash: row.content_hash,
    autosavedAt: row.autosaved_at,
    updatedAt: row.updated_at,
  };
}

function selectDraft(db: DatabaseSync, draftId: number, authorId: number): OriginalDraft | null {
  const row = db.prepare(
    `SELECT id, article_id, author_id, client_key, title, editor_state_json,
            legacy_public_markdown, legacy_paid_markdown, tags_json, unlock_soda_price,
            revision, content_hash, autosaved_at, updated_at
     FROM original_article_drafts
     WHERE id = ? AND author_id = ?`,
  ).get(draftId, authorId) as DraftRow | undefined;
  return row ? toDraft(row) : null;
}

function originalTagIds(db: DatabaseSync, articleId: number): number[] {
  if (!tableExists(db, "original_article_tags")) return [];
  const columns = tableColumns(db, "original_article_tags");
  const articleColumn = columns.has("article_id") ? "article_id" : columns.has("original_article_id") ? "original_article_id" : "";
  const tagColumn = columns.has("tag_id") ? "tag_id" : columns.has("original_tag_id") ? "original_tag_id" : "";
  if (!articleColumn || !tagColumn) return [];
  return (db.prepare(
    `SELECT ${tagColumn} AS id FROM original_article_tags WHERE ${articleColumn} = ? ORDER BY ${tagColumn} ASC`,
  ).all(articleId) as Array<{ id: number }>).map((row) => row.id);
}

function existingArticleForAuthor(db: DatabaseSync, slug: string, authorId: number): {
  id: number;
  title: string;
  body_markdown: string;
  paid_body_markdown: string;
  unlock_soda_price: number;
} | null {
  const row = db.prepare(
    `SELECT id, title, body_markdown, paid_body_markdown, unlock_soda_price
     FROM original_articles
     WHERE slug = ? AND author_id = ?
     LIMIT 1`,
  ).get(slug, authorId) as {
    id: number;
    title: string;
    body_markdown: string;
    paid_body_markdown: string;
    unlock_soda_price: number;
  } | undefined;
  return row || null;
}

export function listOriginalEditorTags(): Array<{ id: number; name: string }> {
  const db = getDb();
  if (!tableExists(db, "tags")) return [];
  const columns = tableColumns(db, "tags");
  const where = columns.has("visibility") ? "WHERE visibility != 'hidden'" : columns.has("is_visible") ? "WHERE is_visible = 1" : "";
  return (db.prepare(`SELECT id, name FROM tags ${where} ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT 300`).all() as Array<{ id: number; name: string }>);
}

export function getOriginalDraftForAuthor(draftId: number, authorId: number): OriginalDraft | null {
  if (!Number.isSafeInteger(draftId) || draftId <= 0 || !Number.isSafeInteger(authorId) || authorId <= 0) return null;
  return selectDraft(getDb(), draftId, authorId);
}

export function createOrResumeOriginalDraft(input: {
  authorId: number;
  clientKey: string;
  articleSlug?: string;
}): OriginalDraft {
  const authorId = Number(input.authorId);
  if (!Number.isSafeInteger(authorId) || authorId <= 0) throw new OriginalDraftError("请先登录", "forbidden");
  const clientKey = String(input.clientKey || "").trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/u.test(clientKey)) throw new OriginalDraftError("草稿标识无效", "invalid");
  const db = getDb();
  const current = db.prepare(
    `SELECT id, article_id, author_id, client_key, title, editor_state_json,
            legacy_public_markdown, legacy_paid_markdown, tags_json, unlock_soda_price,
            revision, content_hash, autosaved_at, updated_at
     FROM original_article_drafts
     WHERE author_id = ? AND client_key = ?`,
  ).get(authorId, clientKey) as DraftRow | undefined;
  if (current) return toDraft(current);

  const article = input.articleSlug ? existingArticleForAuthor(db, input.articleSlug, authorId) : null;
  if (input.articleSlug && !article) throw new OriginalDraftError("文章不存在或无权编辑", "not_found");
  const now = Date.now();
  const title = article?.title || "";
  const publicMarkdown = article?.body_markdown || "";
  const paidMarkdown = article?.paid_body_markdown || "";
  const tagIds = article ? originalTagIds(db, article.id) : [];
  const price = Math.max(0, Math.floor(article?.unlock_soda_price || 0));
  const contentHash = hashDraft(title, "", tagIds, price);
  const info = db.prepare(
    `INSERT INTO original_article_drafts (
       article_id, author_id, client_key, title, legacy_public_markdown, legacy_paid_markdown,
       tags_json, unlock_soda_price, revision, content_hash, autosaved_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    article?.id || null,
    authorId,
    clientKey,
    title,
    publicMarkdown,
    paidMarkdown,
    JSON.stringify(tagIds),
    price,
    contentHash,
    now,
    now,
    now,
  );
  return selectDraft(db, Number(info.lastInsertRowid), authorId)!;
}

export function saveOriginalDraft(input: SaveDraftInput): SaveDraftResult {
  if (Buffer.byteLength(input.editorStateJson, "utf8") > MAX_DRAFT_JSON_BYTES) {
    throw new OriginalDraftError("文章内容超过草稿保存上限", "invalid");
  }
  const title = input.title.normalize("NFKC").trim().slice(0, MAX_TITLE_LENGTH);
  const tagIds = cleanTagIds(input.tagIds);
  const price = Math.min(Math.max(Math.floor(input.unlockSodaPrice || 0), 0), 1_000_000);
  const contentHash = hashDraft(title, input.editorStateJson, tagIds, price);
  const db = getDb();
  const now = Date.now();
  const info = db.prepare(
    `UPDATE original_article_drafts
     SET title = ?, editor_state_json = ?, tags_json = ?, unlock_soda_price = ?,
         revision = revision + 1, content_hash = ?, autosaved_at = ?, updated_at = ?
     WHERE id = ? AND author_id = ? AND revision = ?`,
  ).run(
    title,
    input.editorStateJson,
    JSON.stringify(tagIds),
    price,
    contentHash,
    now,
    now,
    input.draftId,
    input.authorId,
    input.revision,
  );
  const draft = selectDraft(db, input.draftId, input.authorId);
  if (!draft) throw new OriginalDraftError("草稿不存在", "not_found");
  return Number(info.changes) > 0 ? { ok: true, draft } : { ok: false, conflict: true, draft };
}

function slugBase(title: string): string {
  const ascii = title.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return ascii.length >= 3 ? ascii : `article-${Date.now().toString(36)}`;
}

function uniqueSlug(db: DatabaseSync, title: string, excludeArticleId = 0): string {
  const base = slugBase(title);
  const exists = db.prepare("SELECT 1 AS found FROM original_articles WHERE slug = ? AND id != ?");
  if (!exists.get(base, excludeArticleId)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 78 - suffix.length)}${suffix}`;
    if (!exists.get(candidate, excludeArticleId)) return candidate;
  }
  return `article-${crypto.randomBytes(8).toString("hex")}`;
}

function updateBalancesForFee(
  db: DatabaseSync,
  user: { id: number; soda_balance: number; cookie_balance: number },
  fee: number,
  mutationId: string,
  source: "original_publish" | "original_edit",
): void {
  if (fee <= 0) return;
  let soda = Math.max(0, Math.floor(user.soda_balance || 0));
  let cookie = Math.max(0, Math.floor(user.cookie_balance || 0));
  if (soda < fee && isBidirectionalCurrencyExchangeEnabled()) {
    const rate = getCookieToSodaRate();
    const cookiesNeeded = Math.ceil((fee - soda) / rate);
    if (cookie >= cookiesNeeded) {
      cookie -= cookiesNeeded;
      const received = cookiesNeeded * rate;
      soda += received;
      db.prepare(
        "UPDATE users SET cookie_balance = ?, soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(cookie, soda, user.id);
      db.prepare(
        `INSERT INTO user_currency_transactions (
           user_id, currency, amount, balance_after, source, reference_key, note
         ) VALUES (?, 'cookie', ?, ?, 'exchange', ?, '原创发布费用自动兑换')`,
      ).run(user.id, -cookiesNeeded, cookie, `${mutationId}:auto-cookie`);
      db.prepare(
        `INSERT INTO user_currency_transactions (
           user_id, currency, amount, balance_after, source, reference_key, note
         ) VALUES (?, 'soda', ?, ?, 'exchange', ?, '原创发布费用自动兑换')`,
      ).run(user.id, received, soda, `${mutationId}:auto-soda`);
    }
  }
  if (soda < fee) {
    throw new OriginalDraftError(`发布资格已满足，但还需要 ${fee - soda} 苏打支付费用`, "insufficient_balance");
  }
  soda -= fee;
  db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(soda, user.id);
  db.prepare(
    `INSERT INTO user_currency_transactions (
       user_id, currency, amount, balance_after, source, reference_key, note
     ) VALUES (?, 'soda', ?, ?, ?, ?, ?)`,
  ).run(
    user.id,
    -fee,
    soda,
    source,
    mutationId,
    source === "original_publish" ? "发布原创文章" : "编辑原创文章",
  );
}

function writeArticle(
  db: DatabaseSync,
  input: {
    articleId: number | null;
    authorId: number;
    slug: string;
    title: string;
    excerpt: string;
    publicMarkdown: string;
    paidMarkdown: string;
    price: number;
    wordCount: number;
  },
): number {
  const columns = tableColumns(db, "original_articles");
  if (!columns.has("author_id") || !columns.has("slug") || !columns.has("title") || !columns.has("body_markdown")) {
    throw new OriginalDraftError("原创文章表结构不兼容", "unavailable");
  }
  const values: Record<string, unknown> = {
    author_id: input.authorId,
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    body_markdown: input.publicMarkdown,
    paid_body_markdown: input.paidMarkdown,
    unlock_soda_price: input.price,
    status: "published",
    word_count: input.wordCount,
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (input.articleId) {
    const assignments = Object.keys(values).filter((key) => columns.has(key) && key !== "author_id")
      .map((key) => `${key} = ?`);
    const bind = Object.keys(values).filter((key) => columns.has(key) && key !== "author_id").map((key) => values[key]);
    const changed = db.prepare(
      `UPDATE original_articles SET ${assignments.join(", ")} WHERE id = ? AND author_id = ?`,
    ).run(...bind, input.articleId, input.authorId).changes;
    if (!changed) throw new OriginalDraftError("文章不存在或无权编辑", "not_found");
    return input.articleId;
  }
  const insertKeys = Object.keys(values).filter((key) => columns.has(key));
  const info = db.prepare(
    `INSERT INTO original_articles (${insertKeys.join(", ")}) VALUES (${insertKeys.map(() => "?").join(", ")})`,
  ).run(...insertKeys.map((key) => values[key]));
  return Number(info.lastInsertRowid);
}

function replaceArticleTags(db: DatabaseSync, articleId: number, tagIds: number[]): void {
  if (!tableExists(db, "original_article_tags")) return;
  const columns = tableColumns(db, "original_article_tags");
  const articleColumn = columns.has("article_id") ? "article_id" : columns.has("original_article_id") ? "original_article_id" : "";
  const tagColumn = columns.has("tag_id") ? "tag_id" : columns.has("original_tag_id") ? "original_tag_id" : "";
  if (!articleColumn || !tagColumn) return;
  db.prepare(`DELETE FROM original_article_tags WHERE ${articleColumn} = ?`).run(articleId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO original_article_tags (${articleColumn}, ${tagColumn}) VALUES (?, ?)`,
  );
  for (const tagId of tagIds) insert.run(articleId, tagId);
}

function updateAssets(
  db: DatabaseSync,
  ownerId: number,
  articleId: number,
  publicAssetIds: number[],
  paidAssetIds: number[],
): void {
  const all = [...new Set([...publicAssetIds, ...paidAssetIds])];
  if (!all.length) return;
  const placeholders = all.map(() => "?").join(",");
  const owned = db.prepare(
    `SELECT id FROM original_assets WHERE owner_id = ? AND id IN (${placeholders})`,
  ).all(ownerId, ...all) as Array<{ id: number }>;
  if (owned.length !== all.length) throw new OriginalDraftError("文章包含无权使用的图片", "forbidden");
  const publicSet = new Set(publicAssetIds);
  const update = db.prepare(
    "UPDATE original_assets SET article_id = ?, access_scope = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
  );
  const now = Date.now();
  for (const id of all) update.run(articleId, publicSet.has(id) ? "public" : "paid", now, id, ownerId);
}

function pruneRevisions(db: DatabaseSync, articleId: number): void {
  db.prepare(
    `DELETE FROM original_article_revisions
     WHERE article_id = ? AND id NOT IN (
       SELECT id FROM original_article_revisions WHERE article_id = ? ORDER BY revision_no DESC LIMIT 20
     )`,
  ).run(articleId, articleId);
}

export function publishOriginalDraft(input: {
  draftId: number;
  author: UserProfile;
  expectedRevision: number;
  mutationId: string;
}): PublishDraftResult {
  const mutationId = normalizeMutationId(input.mutationId);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = readMutationReceipt<PublishDraftResult>(db, mutationId, input.author.id, "original.publish");
    if (previous) {
      db.exec("COMMIT");
      return previous;
    }
    const draft = selectDraft(db, input.draftId, input.author.id);
    if (!draft) throw new OriginalDraftError("草稿不存在", "not_found");
    if (draft.revision !== input.expectedRevision) throw new OriginalDraftError("草稿已在其他页面更新，请先处理冲突", "conflict");
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
    const user = db.prepare(
      "SELECT id, status, trust_level, soda_balance, cookie_balance FROM users WHERE id = ?",
    ).get(input.author.id) as {
      id: number;
      status: string;
      trust_level: number;
      soda_balance: number;
      cookie_balance: number;
    } | undefined;
    if (!user || user.status !== "active") throw new OriginalDraftError("账号不可用", "forbidden");
    const created = !draft.articleId;
    if (created) {
      const totalValue = user.soda_balance + user.cookie_balance * getCookieToSodaRate();
      if (user.trust_level < settings.minLevel && totalValue < settings.minSoda) {
        throw new OriginalDraftError(`达到 Lv.${settings.minLevel} 或拥有足够资产后可发布`, "forbidden");
      }
    }
    const fee = created ? settings.publishFeeSoda : settings.editFeeSoda;
    updateBalancesForFee(
      db,
      user,
      fee,
      mutationId,
      created ? "original_publish" : "original_edit",
    );

    const currentSlug = draft.articleId
      ? (db.prepare("SELECT slug FROM original_articles WHERE id = ? AND author_id = ?").get(
          draft.articleId,
          input.author.id,
        ) as { slug: string } | undefined)?.slug
      : undefined;
    const slug = currentSlug || uniqueSlug(db, title);
    const plainExcerpt = document.publicMarkdown
      .replace(/<!--[^]*?-->/g, " ")
      .replace(/[#>*_`~\[\]()!-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    const articleId = writeArticle(db, {
      articleId: draft.articleId,
      authorId: input.author.id,
      slug,
      title,
      excerpt: plainExcerpt,
      publicMarkdown: document.publicMarkdown,
      paidMarkdown: document.paidMarkdown,
      price,
      wordCount: document.publicWordCount + document.paidWordCount,
    });
    replaceArticleTags(db, articleId, draft.tagIds);
    updateAssets(db, input.author.id, articleId, document.publicAssetIds, document.paidAssetIds);

    const revisionRow = db.prepare(
      "SELECT COALESCE(MAX(revision_no), 0) + 1 AS revision_no FROM original_article_revisions WHERE article_id = ?",
    ).get(articleId) as { revision_no: number };
    const revisionNo = Math.max(1, Number(revisionRow.revision_no) || 1);
    db.prepare(
      `INSERT INTO original_article_revisions (
         article_id, revision_no, title, body_markdown, paid_body_markdown,
         outline_json, editor_state_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      articleId,
      revisionNo,
      title,
      document.publicMarkdown,
      document.paidMarkdown,
      JSON.stringify(document.outline satisfies OriginalOutlineItem[]),
      draft.editorStateJson,
      Date.now(),
    );
    pruneRevisions(db, articleId);
    db.prepare(
      `UPDATE original_article_drafts
       SET article_id = ?, published_at = ?, updated_at = ?
       WHERE id = ? AND author_id = ?`,
    ).run(articleId, Date.now(), Date.now(), draft.id, input.author.id);

    const result: PublishDraftResult = { articleId, slug, created, revisionNo };
    storeMutationReceipt(db, mutationId, input.author.id, "original.publish", result);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function storeOriginalAsset(input: {
  ownerId: number;
  bytes: Buffer;
  width: number;
  height: number;
  mimeType: string;
}): Promise<{ id: number; url: string; width: number; height: number }> {
  const root = path.resolve(process.env.ORIGINAL_ASSET_DIR || path.join(process.cwd(), "data", "original-assets"));
  const ownerDir = path.join(root, String(input.ownerId));
  fs.mkdirSync(ownerDir, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomBytes(10).toString("hex")}.webp`;
  const target = path.join(ownerDir, fileName);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, input.bytes, { flag: "wx" });
  fs.renameSync(temporary, target);
  const now = Date.now();
  try {
    const info = getDb().prepare(
      `INSERT INTO original_assets (
         owner_id, file_name, storage_path, mime_type, width, height, size_bytes,
         access_scope, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).run(
      input.ownerId,
      fileName,
      path.relative(root, target).replace(/\\/g, "/"),
      input.mimeType,
      input.width,
      input.height,
      input.bytes.length,
      now,
      now,
    );
    const id = Number(info.lastInsertRowid);
    return { id, url: `/original/assets/${id}`, width: input.width, height: input.height };
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  }
}

export function originalAssetRoot(): string {
  return path.resolve(process.env.ORIGINAL_ASSET_DIR || path.join(process.cwd(), "data", "original-assets"));
}
