import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import type { PostgresPublicNovel } from "@/domains/catalog/postgres-catalog";
import { canConsumeHomePortal, type HomePortalAccessMode } from "@/lib/home-portal";

type EntitlementRow = QueryResultRow & { allowed: boolean };

export type PostgresNovelReadAccess = Readonly<{
  allowed: boolean;
  reason: "public" | "member" | "admin" | "preview" | "granted" | "login_required" | "unlock_required";
  price: number;
}>;

export const POSTGRES_SODA_NOVEL_PREVIEW_RATIO = 0.3;

export function getPostgresNovelPreviewChapterCount(
  book: Pick<PostgresPublicNovel, "storageMode" | "accessMode" | "sodaPrice" | "chapterCount" | "previewChapterCount">,
): number {
  if (book.storageMode !== "chapters" || book.accessMode !== "soda" || book.sodaPrice <= 0) return 0;
  const automatic = Math.max(1, Math.ceil(book.chapterCount * POSTGRES_SODA_NOVEL_PREVIEW_RATIO));
  return Math.min(book.chapterCount, Math.max(book.previewChapterCount, automatic));
}

/** Resolves the complete-book gate without exposing or loading novel content. */
export async function getPostgresNovelReadAccess(
  executor: SqlExecutor,
  book: Pick<PostgresPublicNovel, "id" | "sourceId" | "accessMode" | "sodaPrice">,
  user: { id: number; role: "user" | "admin" } | null,
  novelAccessMode: HomePortalAccessMode,
  options: { storageMode?: PostgresPublicNovel["storageMode"]; chapterCount?: number; previewChapterCount?: number;
    chapterSortOrder?: number | null; contentPreview?: boolean } = {},
): Promise<PostgresNovelReadAccess> {
  const price = Math.max(Math.floor(book.sodaPrice), 0);
  if (user?.role === "admin") return { allowed: true, reason: "admin", price };
  if (!canConsumeHomePortal(novelAccessMode, Boolean(user))) {
    return { allowed: false, reason: "login_required", price };
  }
  if (book.accessMode !== "soda" || price === 0) {
    return { allowed: true, reason: user ? "member" : "public", price: 0 };
  }
  if (user) {
    if (!Number.isSafeInteger(user.id) || user.id < 1 || !Number.isSafeInteger(book.id) || book.id < 1 ||
        book.sourceId !== null && (!Number.isSafeInteger(book.sourceId) || book.sourceId < 1)) {
      throw new Error("Invalid PostgreSQL novel entitlement input");
    }
    const result = await executor.query<EntitlementRow>({
      name: "reading-check-novel-entitlement-v1",
      text: `SELECT EXISTS (
             SELECT 1
             FROM user_entitlements entitlement
             WHERE entitlement.user_id = $1
               AND (entitlement.expires_at IS NULL OR entitlement.expires_at > clock_timestamp())
               AND entitlement.rights ? 'read'
               AND (
                 (entitlement.resource_type = 'novel' AND entitlement.resource_id = $2)
                 OR ($3::integer IS NOT NULL AND entitlement.resource_type = 'novel_source' AND entitlement.resource_id = $3::text)
               )
           ) AS allowed`,
      values: [user.id, String(book.id), book.sourceId],
    });
    if (result.rows[0]?.allowed === true) return { allowed: true, reason: "granted", price };
  }
  const previewBook = {
    storageMode: options.storageMode ?? "single",
    accessMode: book.accessMode,
    sodaPrice: book.sodaPrice,
    chapterCount: Math.max(Math.floor(options.chapterCount ?? 0), 0),
    previewChapterCount: Math.max(Math.floor(options.previewChapterCount ?? 0), 0),
  };
  if (options.chapterSortOrder !== undefined && options.chapterSortOrder !== null &&
      options.chapterSortOrder < getPostgresNovelPreviewChapterCount(previewBook)) {
    return { allowed: true, reason: "preview", price };
  }
  if (options.contentPreview && previewBook.storageMode !== "chapters") {
    return { allowed: true, reason: "preview", price };
  }
  return user
    ? { allowed: false, reason: "unlock_required", price }
    : { allowed: false, reason: "login_required", price };
}
