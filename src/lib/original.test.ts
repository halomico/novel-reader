import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { readSiteSettings, writeSiteSettings } from "./site-settings";
import {
  addOriginalComment,
  canPublishOriginal,
  clearOriginalReadingProgress,
  createOriginalArticle,
  deleteOriginalReadingProgressMany,
  deleteOriginalComment,
  getAdjacentOriginalArticles,
  getOriginalArticleBySlug,
  getOriginalAccess,
  getOriginalCommentQuota,
  getOriginalReadingProgress,
  listOriginalArticles,
  listBlockedOriginalAuthors,
  listOriginalComments,
  listOriginalReadingHistory,
  listOriginalTags,
  normalizeOriginalSlug,
  OriginalInputError,
  purchaseOriginalArticle,
  recordOriginalReadingOpen,
  setOriginalCommentStatus,
  setOriginalArticlePinned,
  setOriginalArticleStatus,
  setOriginalAuthorBlocked,
  isOriginalAuthorBlocked,
  tipOriginalAuthor,
  updateOriginalArticleAsAdmin,
  updateOriginalArticle,
  updateOriginalComment,
  updateOriginalReadingProgress,
} from "./original";
import { insertOriginalEditorBlock, MAX_ORIGINAL_BODY_LENGTH, ORIGINAL_PAID_MARKER, preserveOriginalMarkdownSpacing } from "./original-constants";
import { extractOriginalOutline, originalHeadingId } from "./original-outline";

test("normalizes percent-encoded original slugs from route segments", () => {
  assert.equal(normalizeOriginalSlug("%E5%9B%9E%E5%BD%92"), "回归");
});

test("extracts a stable article outline without treating fenced code as headings", () => {
  const outline = extractOriginalOutline([
    "# 开始 [阅读](https://example.com)",
    "正文",
    "```md",
    "# 代码里的标题",
    "```",
    "## 第二章 ##",
    "~~~",
    "### 仍然是代码",
    "~~~",
  ].join("\n"));
  assert.deepEqual(outline, [
    { id: originalHeadingId(0), level: 1, text: "开始 阅读" },
    { id: originalHeadingId(1), level: 2, text: "第二章" },
  ]);
});

test("inserts editor dividers as one line without compressing existing breaks", () => {
  assert.deepEqual(insertOriginalEditorBlock("正文", 2, 2, "---"), {
    value: "正文\n---\n",
    cursor: 7,
  });
  assert.deepEqual(insertOriginalEditorBlock("公开\n\n付费", 4, 4, ORIGINAL_PAID_MARKER), {
    value: `公开\n\n${ORIGINAL_PAID_MARKER}\n付费`,
    cursor: 4 + ORIGINAL_PAID_MARKER.length + 1,
  });
  assert.deepEqual(insertOriginalEditorBlock("上\n下", 1, 1, "---"), {
    value: "上\n---\n下",
    cursor: 6,
  });
});

test("preserves prose indentation without rewriting Markdown blocks", () => {
  assert.equal(
    preserveOriginalMarkdownSpacing("  中文缩进\n    四格缩进\n  # 标题\n```\n    code\n```"),
    "\u00a0\u00a0中文缩进\n\u00a0\u00a0\u00a0\u00a0四格缩进\n  # 标题\n```\n    code\n```",
  );
});

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-original-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "settings.json");
  const state = globalThis as typeof globalThis & { novelReaderDb?: { close: () => void }; siteSettingsCache?: unknown };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  delete state.siteSettingsCache;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    delete state.siteSettingsCache;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function allowShortOriginalContent() {
  const settings = readSiteSettings();
  writeSiteSettings({ ...settings, originalArticleMinWords: 1, originalCommentMinChars: 1 });
}

test("original articles derive access from price and transfer paid unlocks exactly once", (t) => {
  withTempDatabase(t);
  allowShortOriginalContent();
  const db = getDb();
  const authorId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('original-author', '作者', 'hash', 1, 20, 0)`,
  ).run().lastInsertRowid);
  const buyerId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('original-buyer', '读者', 'hash', 1, 10, 0)`,
  ).run().lastInsertRowid);
  const author = { id: authorId, role: "user" as const, status: "active" as const, trustLevel: 1, sodaBalance: 20, cookieBalance: 0 };
  const buyer = { id: buyerId, role: "user" as const, status: "active" as const, trustLevel: 1, sodaBalance: 10, cookieBalance: 0 };
  assert.equal(canPublishOriginal(author), true, "余额门槛满足时可发布");

  const paid = createOriginalArticle({
    author,
    title: "付费文章",
    bodyMarkdown: `公开摘要\n\n${ORIGINAL_PAID_MARKER}\n\n完整内容`,
    accessMode: "reply",
    unlockSodaPrice: 10,
    tags: "测试, 原创",
  });
  assert.equal(paid.accessMode, "paid");
  assert.equal(paid.wordCount, Array.from("公开摘要完整内容").length);
  assert.equal(listOriginalArticles({}).items.find((item) => item.id === paid.id)?.bodyMarkdown, "", "列表查询不应加载全文正文");
  assert.equal(getOriginalArticleBySlug(paid.slug)?.bodyMarkdown, "公开摘要\n\n");
  assert.equal(getOriginalArticleBySlug(paid.slug)?.paidBodyMarkdown, "\n\n完整内容");
  assert.equal((db.prepare("SELECT soda_balance FROM users WHERE id = ?").get(authorId) as { soda_balance: number }).soda_balance, 19);
  assert.equal(getOriginalAccess(paid, null).allowed, false);
  assert.equal(getOriginalAccess(paid, buyer).allowed, false);
  assert.deepEqual(purchaseOriginalArticle(paid.id, buyerId), { purchased: true, price: 10 });
  assert.equal((db.prepare("SELECT soda_balance FROM users WHERE id = ?").get(buyerId) as { soda_balance: number }).soda_balance, 0);
  assert.equal((db.prepare("SELECT soda_balance FROM users WHERE id = ?").get(authorId) as { soda_balance: number }).soda_balance, 29);
  assert.equal(getOriginalAccess(paid, buyer).allowed, true);
  assert.deepEqual(purchaseOriginalArticle(paid.id, buyerId), { purchased: true, price: 10 });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM original_purchases WHERE article_id = ?").get(paid.id) as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source IN ('original_purchase', 'original_sale')").get() as { count: number }).count, 2);

  const free = createOriginalArticle({
    author: { ...author, sodaBalance: 19 },
    title: "免费文章",
    bodyMarkdown: "评论不会改变访问权限",
    accessMode: "paid",
    unlockSodaPrice: 0,
  });
  assert.equal(free.accessMode, "free");
  assert.equal(free.unlockSodaPrice, 0);
  assert.equal(getOriginalAccess(free, null).allowed, true, "零价格文章公开可读");
  assert.equal(setOriginalArticlePinned(paid.id, true), true);
  for (const sort of ["latest", "popular", "name"] as const) {
    assert.equal(listOriginalArticles({ sort }).items[0]?.id, paid.id, `${sort} 排序应优先展示置顶文章`);
  }
  assert.equal(getOriginalArticleBySlug(paid.slug)?.isPinned, true);
  assert.ok(getOriginalArticleBySlug(paid.slug)?.pinnedAt);
  assert.equal(setOriginalArticlePinned(paid.id, true), false, "重复置顶不应产生写入");
  assert.equal(setOriginalArticlePinned(paid.id, false), true);
  assert.equal(listOriginalArticles({ sort: "latest" }).items[0]?.id, free.id);
  recordOriginalReadingOpen(buyerId, free.id);
  recordOriginalReadingOpen(buyerId, free.id);
  assert.deepEqual(listOriginalReadingHistory(buyerId).items[0], {
    articleId: free.id,
    slug: free.slug,
    title: free.title,
    authorId,
    authorName: "作者",
    authorAvatarPath: null,
    wordCount: free.wordCount,
    unlockSodaPrice: 0,
    visitCount: 2,
    scrollRatio: 0,
    progressPercent: 0,
    completed: false,
    lastReadAt: listOriginalReadingHistory(buyerId).items[0]?.lastReadAt,
  });
  assert.equal(updateOriginalReadingProgress(buyerId, free.id, 0.5).saved, true);
  assert.equal(getOriginalReadingProgress(buyerId, free.id)?.progressPercent, 50);
  assert.equal(listOriginalReadingHistory(buyerId).items[0]?.progressPercent, 50);
  assert.equal(deleteOriginalReadingProgressMany(buyerId, [free.id, free.id, 999]), 1);
  assert.equal(listOriginalReadingHistory(buyerId).totalItems, 0);
  assert.equal(getOriginalReadingProgress(buyerId, free.id)?.progressPercent, 50, "移除最近记录不应丢失恢复位置");
  recordOriginalReadingOpen(buyerId, free.id);
  assert.equal(listOriginalReadingHistory(buyerId).totalItems, 1);
  assert.equal(clearOriginalReadingProgress(buyerId), 1);
  assert.equal(listOriginalReadingHistory(buyerId).totalItems, 0);
  db.prepare("UPDATE users SET original_reading_history_enabled = 0 WHERE id = ?").run(buyerId);
  recordOriginalReadingOpen(buyerId, free.id);
  assert.equal(listOriginalReadingHistory(buyerId).totalItems, 0, "关闭阅读进度后不应重新加入最近");
  assert.equal(updateOriginalReadingProgress(buyerId, free.id, 0.8).saved, false);
  assert.equal(getOriginalReadingProgress(buyerId, free.id)?.progressPercent, 50);
  db.prepare("UPDATE users SET original_reading_history_enabled = 1, reading_history_enabled = 0 WHERE id = ?").run(buyerId);
  recordOriginalReadingOpen(buyerId, free.id);
  assert.equal(listOriginalReadingHistory(buyerId).totalItems, 1, "小说开关不应影响原创最近记录");
  assert.equal(clearOriginalReadingProgress(buyerId), 1);
  db.prepare("UPDATE users SET reading_history_enabled = 1 WHERE id = ?").run(buyerId);
  addOriginalComment(free.id, buyerId, "我的回复");
  assert.equal(getOriginalAccess(free, buyer).allowed, true, "评论不参与正文访问判定");
  assert.equal(listOriginalArticles({ query: "免费文章" }).totalItems, 1);
  assert.deepEqual(listOriginalArticles({ query: "免费 文章" }).items.map((item) => item.id), [free.id], "空格分隔关键词必须按 AND 匹配");
  assert.deepEqual(listOriginalArticles({ query: "付费 文章" }).items.map((item) => item.id), [paid.id], "多关键词不能退化为任一词命中");
  assert.equal(listOriginalArticles({ query: `%' OR 1=1 --` }).totalItems, 0, "SQL 形状输入必须作为普通搜索文本处理");
  assert.equal(listOriginalTags({ publishedOnly: true }).some((tag) => tag.name === "测试"), true);

  const longBody = updateOriginalArticleAsAdmin({
    articleId: free.id,
    title: "免费文章",
    bodyMarkdown: "字".repeat(MAX_ORIGINAL_BODY_LENGTH + 100),
  });
  assert.equal(longBody.bodyMarkdown.length, MAX_ORIGINAL_BODY_LENGTH);

  db.prepare("UPDATE original_articles SET published_at = '2000-01-01 00:00:00' WHERE id = ?").run(free.id);
  assert.equal(setOriginalArticleStatus(free.id, "hidden"), true);
  assert.equal(listOriginalArticles({}).items.some((item) => item.id === free.id), false);
  assert.equal(setOriginalArticleStatus(free.id, "published"), true);
  assert.equal(listOriginalArticles({}).items.some((item) => item.id === free.id), true);
  assert.notEqual(
    (db.prepare("SELECT published_at FROM original_articles WHERE id = ?").get(free.id) as { published_at: string }).published_at,
    "2000-01-01 00:00:00",
  );

  const draft = createOriginalArticle({
    author: { ...author, sodaBalance: 18 },
    title: "隐藏标签文章",
    bodyMarkdown: "后台审核中",
    tags: "仅隐藏",
  });
  assert.equal(setOriginalArticleStatus(draft.id, "hidden"), true);
  assert.equal(setOriginalArticlePinned(draft.id, true), false, "隐藏文章不能置顶");
  assert.equal(listOriginalTags({ publishedOnly: true }).some((tag) => tag.name === "仅隐藏"), false);
  assert.equal(listOriginalTags().some((tag) => tag.name === "仅隐藏"), true);
});

test("enforces configurable article, reply, and compact tag rules", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const authorId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('original-rule-author', '规则作者', 'hash', 2, 20, 0)`,
  ).run().lastInsertRowid);
  const author = { id: authorId, role: "user" as const, status: "active" as const, trustLevel: 2, sodaBalance: 20, cookieBalance: 0 };
  assert.throws(
    () => createOriginalArticle({ author, title: "太短", bodyMarkdown: "不足两千字" }),
    (error: unknown) => error instanceof OriginalInputError && error.message === "文章至少需要 2000 字",
  );
  assert.throws(
    () => createOriginalArticle({ author, title: "标签错误", bodyMarkdown: "字".repeat(2_000), tags: "带 空格" }),
    (error: unknown) => error instanceof OriginalInputError && error.message.includes("不能包含空格"),
  );
  assert.throws(
    () => createOriginalArticle({ author, title: "标签过多", bodyMarkdown: "字".repeat(2_000), tags: "aa,bb,cc,dd,ee,ff,gg,hh,ii" }),
    (error: unknown) => error instanceof OriginalInputError && error.message === "每篇文章最多添加 8 个标签",
  );
  const article = createOriginalArticle({ author, title: "符合规则", bodyMarkdown: "字".repeat(2_000), tags: "原创,Writing" });
  assert.throws(
    () => addOriginalComment(article.id, author, "短"),
    (error: unknown) => error instanceof OriginalInputError && error.message === "评论至少需要 4 个字符",
  );
  assert.equal(addOriginalComment(article.id, author, "四个字符").bodyMarkdown, "四个字符");
});

test("rejects stale mutations after the original channel is disabled", (t) => {
  withTempDatabase(t);
  allowShortOriginalContent();
  const db = getDb();
  const authorId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('original-switch-author', '作者', 'hash', 1, 20, 0)`,
  ).run().lastInsertRowid);
  const buyerId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('original-switch-buyer', '读者', 'hash', 1, 20, 0)`,
  ).run().lastInsertRowid);
  const author = { id: authorId, role: "user" as const, status: "active" as const, trustLevel: 1, sodaBalance: 20, cookieBalance: 0 };
  const article = createOriginalArticle({ author, title: "开关边界文章", bodyMarkdown: "正文" });
  const comment = addOriginalComment(article.id, buyerId, "待审核回复");
  assert.equal(listOriginalComments(article.id).length, 1);
  assert.equal(setOriginalCommentStatus(comment.id, "hidden"), true);
  assert.equal(listOriginalComments(article.id).length, 0);
  assert.equal(listOriginalComments(article.id, { includeHidden: true }).length, 1);

  const currentSettings = readSiteSettings();
  writeSiteSettings({
    ...currentSettings,
    homePortalAccessModes: { ...currentSettings.homePortalAccessModes, original: "off" },
  });
  assert.throws(
    () => updateOriginalArticle({ articleId: article.id, author, title: "修改", bodyMarkdown: "新正文" }),
    (error: unknown) => error instanceof OriginalInputError && error.message === "原创频道暂未开放",
  );
  assert.throws(
    () => addOriginalComment(article.id, buyerId, "过期提交"),
    (error: unknown) => error instanceof OriginalInputError && error.message === "原创频道暂未开放",
  );
  assert.throws(
    () => purchaseOriginalArticle(article.id, buyerId),
    (error: unknown) => error instanceof OriginalInputError && error.message === "原创频道暂未开放",
  );
  const edited = updateOriginalArticleAsAdmin({ articleId: article.id, title: "管理员修订", bodyMarkdown: "新正文" });
  assert.equal(edited.title, "管理员修订");
});

test("requires an explicit paid divider and charges replies after the level quota", (t) => {
  withTempDatabase(t);
  allowShortOriginalContent();
  const db = getDb();
  const authorId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('divider-author', '作者', 'hash', 2, 30, 0)`,
  ).run().lastInsertRowid);
  const commenterId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('quota-commenter', '评论者', 'hash', 1, 10, 0)`,
  ).run().lastInsertRowid);
  const author = { id: authorId, role: "user" as const, status: "active" as const, trustLevel: 2, sodaBalance: 30, cookieBalance: 0 };
  assert.throws(
    () => createOriginalArticle({ author, title: "缺少分界", bodyMarkdown: "公开\n\n付费", unlockSodaPrice: 3 }),
    (error: unknown) => error instanceof OriginalInputError && error.message.includes("付费分界"),
  );
  const article = createOriginalArticle({ author, title: "额度测试", bodyMarkdown: "正文" });
  const commenter = { id: commenterId, role: "user" as const, trustLevel: 1 };
  assert.equal(getOriginalCommentQuota(commenter).remainingFree, 3);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(addOriginalComment(article.id, commenter, `回复 ${index}`).chargedSoda, 0);
  }
  const charged = addOriginalComment(article.id, commenter, "超出额度");
  assert.equal(charged.chargedSoda, 1);
  assert.equal(charged.remainingFree, 0);
  assert.equal((db.prepare("SELECT soda_balance FROM users WHERE id = ?").get(commenterId) as { soda_balance: number }).soda_balance, 9);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source = 'original_comment'").get() as { count: number }).count, 1);
  const edited = updateOriginalComment(charged.id, commenterId, "编辑后的回复");
  assert.equal(edited.bodyMarkdown, "编辑后的回复");
  assert.equal(edited.chargedSoda, 1);
  assert.equal(deleteOriginalComment(charged.id, commenterId)?.chargedSoda, 1);
  assert.equal(getOriginalCommentQuota(commenter).usedToday, 6, "发布、编辑和删除应共用当日额度");
  const chargedAfterDelete = addOriginalComment(article.id, commenter, "删除后再次回复");
  assert.equal(chargedAfterDelete.chargedSoda, 1);
  assert.equal((db.prepare("SELECT soda_balance FROM users WHERE id = ?").get(commenterId) as { soda_balance: number }).soda_balance, 6);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source = 'original_comment'").get() as { count: number }).count, 4);
});

test("supports chronological article navigation, one-soda tips, and author blocks", (t) => {
  withTempDatabase(t);
  allowShortOriginalContent();
  const db = getDb();
  const firstAuthorId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('stream-author-a', '作者甲', 'hash', 1, 20, 0)`,
  ).run().lastInsertRowid);
  const blockedAuthorId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('stream-author-b', '作者乙', 'hash', 1, 20, 0)`,
  ).run().lastInsertRowid);
  const readerId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, trust_level, soda_balance, cookie_balance)
     VALUES ('stream-reader', '读者', 'hash', 1, 5, 0)`,
  ).run().lastInsertRowid);
  const authorA = { id: firstAuthorId, role: "user" as const, status: "active" as const, trustLevel: 1, sodaBalance: 20, cookieBalance: 0 };
  const authorB = { id: blockedAuthorId, role: "user" as const, status: "active" as const, trustLevel: 1, sodaBalance: 20, cookieBalance: 0 };
  const oldest = createOriginalArticle({ author: authorA, title: "最早文章", bodyMarkdown: "正文一" });
  const middle = createOriginalArticle({ author: authorB, title: "中间文章", bodyMarkdown: "正文二" });
  const newest = createOriginalArticle({ author: { ...authorA, sodaBalance: 19 }, title: "最新文章", bodyMarkdown: "正文三" });
  assert.equal(getAdjacentOriginalArticles(oldest.id).previous?.id, middle.id);
  assert.equal(setOriginalAuthorBlocked(readerId, blockedAuthorId, true), true);
  assert.equal(isOriginalAuthorBlocked(readerId, blockedAuthorId), true);
  assert.equal(getAdjacentOriginalArticles(oldest.id, readerId).previous?.id, newest.id);
  assert.equal(listOriginalArticles({ viewerId: readerId }).items.some((item) => item.id === middle.id), false);
  assert.equal(listBlockedOriginalAuthors(readerId)[0]?.authorId, blockedAuthorId);

  addOriginalComment(oldest.id, authorB, "这条评论会被屏蔽");
  assert.equal(listOriginalComments(oldest.id).length, 1);
  assert.equal(listOriginalComments(oldest.id, { viewerId: readerId }).length, 0);

  assert.deepEqual(tipOriginalAuthor(oldest.id, readerId), { amount: 1, balance: 4, authorId: firstAuthorId });
  assert.equal((db.prepare("SELECT soda_balance FROM users WHERE id = ?").get(firstAuthorId) as { soda_balance: number }).soda_balance, 19);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source IN ('original_tip', 'original_tip_income')").get() as { count: number }).count, 2);
  assert.throws(() => tipOriginalAuthor(oldest.id, firstAuthorId), /不能打赏自己的文章/u);
  assert.equal(setOriginalAuthorBlocked(readerId, blockedAuthorId, false), true);
  assert.equal(isOriginalAuthorBlocked(readerId, blockedAuthorId), false);
});
