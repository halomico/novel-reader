import type { Novel } from "./books";
import { canConsumeNovelLibrary } from "./config";
import { getDb } from "./db";
import { grantUserEntitlement, hasNovelReadEntitlement } from "./entitlements";
import type { NovelSegment } from "./segments";

type NovelAccessUser = { id: number; role: "user" | "admin" } | null;
type NovelAccessBook = Pick<
  Novel,
  "id" | "source_id" | "storage_mode" | "chapter_count" | "access_mode" | "soda_price" | "preview_chapter_count"
>;

export const SODA_NOVEL_PREVIEW_RATIO = 0.3;

export type NovelReadAccess = {
  allowed: boolean;
  price: number;
  reason: "public" | "member" | "admin" | "preview" | "granted" | "login_required" | "unlock_required";
};

export function getNovelPreviewChapterCount(book: NovelAccessBook): number {
  if (book.storage_mode !== "chapters" || book.access_mode !== "soda" || book.soda_price <= 0) return 0;
  const chapterCount = Math.max(Math.floor(book.chapter_count || 0), 0);
  if (!chapterCount) return 0;
  const configuredCount = Math.max(Math.floor(book.preview_chapter_count || 0), 0);
  const automaticCount = Math.max(1, Math.ceil(chapterCount * SODA_NOVEL_PREVIEW_RATIO));
  return Math.min(chapterCount, Math.max(configuredCount, automaticCount));
}

export function getSodaNovelPreviewSegments(segments: NovelSegment[]): NovelSegment[] {
  const totalChars = segments.at(-1)?.charEnd || 0;
  if (!totalChars) return [];
  const previewEnd = Math.max(1, Math.ceil(totalChars * SODA_NOVEL_PREVIEW_RATIO));
  const preview: NovelSegment[] = [];

  for (const segment of segments) {
    if (segment.charStart >= previewEnd) break;
    if (segment.charEnd <= previewEnd) {
      preview.push(segment);
      continue;
    }

    const targetLength = Math.max(previewEnd - segment.charStart, 0);
    let content = segment.content.slice(0, targetLength);
    const paragraphBreak = content.lastIndexOf("\n");
    if (paragraphBreak >= Math.floor(content.length * 0.72)) {
      content = content.slice(0, paragraphBreak + 1);
    }
    if (content.trim()) {
      preview.push({ ...segment, charEnd: segment.charStart + content.length, content });
    }
    break;
  }

  return preview;
}

export function getNovelReadAccess(
  book: NovelAccessBook,
  user: NovelAccessUser,
  options: { chapterSortOrder?: number | null; contentPreview?: boolean } = {},
): NovelReadAccess {
  const price = Math.max(Math.floor(book.soda_price || 0), 0);
  if (user?.role === "admin") {
    return { allowed: true, price, reason: "admin" };
  }
  if (!canConsumeNovelLibrary(Boolean(user))) {
    return { allowed: false, price, reason: "login_required" };
  }
  if (book.access_mode !== "soda" || price === 0) {
    return { allowed: true, price: 0, reason: user ? "member" : "public" };
  }
  if (user && hasNovelReadEntitlement(user.id, book.id, book.source_id)) {
    return { allowed: true, price, reason: "granted" };
  }
  if (
    options.chapterSortOrder !== undefined &&
    options.chapterSortOrder !== null &&
    options.chapterSortOrder < getNovelPreviewChapterCount(book)
  ) {
    return { allowed: true, price, reason: "preview" };
  }
  if (options.contentPreview && book.storage_mode !== "chapters") {
    return { allowed: true, price, reason: "preview" };
  }
  if (!user) {
    return { allowed: false, price, reason: "login_required" };
  }
  return { allowed: false, price, reason: "unlock_required" };
}

export function listReadableNovelIds(user: NovelAccessUser): number[] {
  const db = getDb();
  if (user?.role === "admin") {
    return (db.prepare("SELECT id FROM novels ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
  }
  if (!canConsumeNovelLibrary(Boolean(user))) return [];
  if (!user) {
    return (db.prepare(
      "SELECT id FROM novels WHERE access_mode <> 'soda' OR soda_price <= 0 ORDER BY id",
    ).all() as Array<{ id: number }>).map((row) => row.id);
  }
  return (db.prepare(
    `SELECT n.id
     FROM novels n
     WHERE n.access_mode <> 'soda'
        OR n.soda_price <= 0
        OR EXISTS (
          SELECT 1 FROM user_entitlements e
          WHERE e.user_id = ?
            AND (e.expires_at IS NULL OR datetime(e.expires_at) > CURRENT_TIMESTAMP)
            AND instr(e.rights, '"read"') > 0
            AND (
              (e.resource_type = 'novel' AND e.resource_id = CAST(n.id AS TEXT))
              OR (e.resource_type = 'novel_source' AND e.resource_id = CAST(n.source_id AS TEXT))
            )
        )
     ORDER BY n.id`,
  ).all(user.id) as Array<{ id: number }>).map((row) => row.id);
}

export type NovelUnlockResult =
  | { ok: true; charged: boolean; sodaBalance: number }
  | { ok: false; reason: "not_found" | "account_unavailable" | "insufficient_soda" };

export function unlockNovelWithSoda(userId: number, novelId: number): NovelUnlockResult {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const book = db.prepare(
      `SELECT id, source_id, access_mode, soda_price
       FROM novels WHERE id = ?`,
    ).get(novelId) as {
      id: number;
      source_id: number | null;
      access_mode: string;
      soda_price: number;
    } | undefined;
    if (!book) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const user = db.prepare(
      "SELECT status, role, soda_balance FROM users WHERE id = ?",
    ).get(userId) as { status: string; role: string; soda_balance: number } | undefined;
    if (!user || user.status !== "active") {
      db.exec("ROLLBACK");
      return { ok: false, reason: "account_unavailable" };
    }
    const price = Math.max(Math.floor(book.soda_price || 0), 0);
    if (
      user.role === "admin" ||
      book.access_mode !== "soda" ||
      price === 0 ||
      hasNovelReadEntitlement(userId, book.id, book.source_id)
    ) {
      db.exec("COMMIT");
      return { ok: true, charged: false, sodaBalance: user.soda_balance };
    }
    if (user.soda_balance < price) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient_soda" };
    }
    const sodaBalance = user.soda_balance - price;
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(sodaBalance, userId);
    grantUserEntitlement({
      userId,
      definition: {
        targetType: "novel",
        targetId: String(novelId),
        rights: ["read"],
        durationSeconds: null,
      },
      db,
    });
    db.prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       ) VALUES (?, 'soda', ?, ?, 'novel_unlock', ?, '小说永久阅读权限')`,
    ).run(userId, -price, sodaBalance, `novel-unlock:${userId}:${novelId}`);
    db.exec("COMMIT");
    return { ok: true, charged: true, sodaBalance };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
