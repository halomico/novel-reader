export type OriginalAccessMode = "free" | "paid";
export type OriginalArticleStatus = "draft" | "published" | "hidden";
export type OriginalSort = "latest" | "popular" | "name";
export type OriginalSortOrder = "asc" | "desc";

export function normalizeOriginalSort(value: string | undefined): OriginalSort {
  return value === "popular" || value === "name" ? value : "latest";
}

export function defaultOriginalSortOrder(sort: OriginalSort): OriginalSortOrder {
  return sort === "name" ? "asc" : "desc";
}

export function normalizeOriginalSortOrder(
  value: string | undefined,
  sort: OriginalSort,
): OriginalSortOrder {
  return value === "asc" || value === "desc" ? value : defaultOriginalSortOrder(sort);
}

export type OriginalTag = Readonly<{
  id: number;
  name: string;
  slug: string;
}>;

export type OriginalArticle = Readonly<{
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
  tags: readonly OriginalTag[];
}>;

export type OriginalComment = Readonly<{
  id: number;
  articleId: number;
  authorId: number;
  authorName: string;
  authorAvatarPath: string | null;
  bodyMarkdown: string;
  status: "published" | "hidden";
  createdAt: string;
  updatedAt: string;
}>;

export type OriginalCommentActivity = OriginalComment & Readonly<{
  articleSlug: string;
  articleTitle: string;
}>;

export type OriginalCommentQuota = Readonly<{
  freeLimit: number | null;
  usedToday: number;
  remainingFree: number | null;
  nextCommentCost: number;
}>;

export type OriginalCommentSubmitResult = OriginalComment & Readonly<{
  comment: OriginalComment;
  chargedSoda: number;
  remainingFree: number | null;
}>;

export type OriginalCommentMutationResult = Readonly<{
  chargedSoda: number;
  remainingFree: number | null;
}>;

export type OriginalCommentUpdateResult = OriginalComment & OriginalCommentMutationResult;

export type OriginalBlockedAuthor = Readonly<{
  authorId: number;
  displayName: string;
  avatarPath: string | null;
  trustLevel: number;
  articleCount: number;
  blockedAt: string;
}>;

export type OriginalAdjacentArticles = Readonly<{
  previous: Pick<OriginalArticle, "id" | "slug" | "title"> | null;
  next: Pick<OriginalArticle, "id" | "slug" | "title"> | null;
}>;

export type OriginalCommentActivityList = Readonly<{
  items: readonly OriginalCommentActivity[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

export type OriginalArticleList = Readonly<{
  items: readonly OriginalArticle[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

export type OriginalCommentPage = Readonly<{
  items: readonly OriginalComment[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

export type OriginalAccess = Readonly<{
  allowed: boolean;
  purchased: boolean;
  reason: "public" | "purchase" | "hidden" | "login";
}>;

export class OriginalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginalInputError";
  }
}

function cleanText(value: unknown, maximum: number): string {
  return Array.from(String(value ?? "").normalize("NFKC").replace(/\r\n?/gu, "\n").trim())
    .slice(0, maximum)
    .join("");
}

/** Accept both decoded and (occasionally) still encoded dynamic route values. */
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
