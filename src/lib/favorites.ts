import type { Novel } from "./books";
import { getDb } from "./db";

export type FavoriteNovelPage = {
  books: Novel[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalPages: number;
};

export function isNovelFavorite(userId: number, novelId: number): boolean {
  return Boolean(getDb()
    .prepare("SELECT 1 AS found FROM user_novel_favorites WHERE user_id = ? AND novel_id = ?")
    .get(userId, novelId));
}

export function toggleNovelFavorite(userId: number, novelId: number): { ok: boolean; favorite: boolean } {
  const db = getDb();
  const removed = db
    .prepare("DELETE FROM user_novel_favorites WHERE user_id = ? AND novel_id = ?")
    .run(userId, novelId);
  if (removed.changes > 0) {
    return { ok: true, favorite: false };
  }
  const added = db
    .prepare(
      `INSERT INTO user_novel_favorites (user_id, novel_id)
       SELECT ?, id FROM novels WHERE id = ?`,
    )
    .run(userId, novelId);
  return { ok: added.changes > 0, favorite: added.changes > 0 };
}

export function listFavoriteNovels(userId: number, pageValue = 1, pageSizeValue = 20): FavoriteNovelPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(pageSizeValue), 1), 100);
  const total = db
    .prepare("SELECT COUNT(*) AS count FROM user_novel_favorites WHERE user_id = ?")
    .get(userId) as { count: number };
  const totalPages = Math.max(Math.ceil(total.count / pageSize), 1);
  const requestedPage = Number.isFinite(pageValue) ? Math.floor(pageValue) : 1;
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const books = db
    .prepare(
      `SELECT n.id, n.title, n.file_name, n.relative_path, n.content_hash,
              n.size_bytes, n.mtime_ms, n.word_count, n.visit_count,
              n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent,
              n.created_at, n.updated_at
       FROM user_novel_favorites f
       INNER JOIN novels n ON n.id = f.novel_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC, f.novel_id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, pageSize, (page - 1) * pageSize) as Novel[];
  return { books, page, pageSize, totalBooks: total.count, totalPages };
}
