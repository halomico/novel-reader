import { getDb } from "./db";

export type PinnedNovel = {
  id: number;
  title: string;
  sortOrder: number;
  createdAt: string;
};

type PinnedNovelRow = {
  id: number;
  title: string;
  sort_order: number;
  created_at: string;
};

function mapPinnedNovel(row: PinnedNovelRow): PinnedNovel {
  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function listPinnedNovels(): PinnedNovel[] {
  const rows = getDb()
    .prepare(
      `SELECT n.id, n.title, p.sort_order, p.created_at
       FROM pinned_novels p
       JOIN novels n ON n.id = p.novel_id
       ORDER BY p.sort_order ASC, p.novel_id ASC`,
    )
    .all() as PinnedNovelRow[];
  return rows.map(mapPinnedNovel);
}

export function listPinnedNovelIds(): number[] {
  return listPinnedNovels().map((book) => book.id);
}

export function isNovelPinned(novelId: number): boolean {
  if (!Number.isInteger(novelId) || novelId < 1) {
    return false;
  }
  return Boolean(getDb().prepare("SELECT 1 AS found FROM pinned_novels WHERE novel_id = ?").get(novelId));
}

export function pinNovel(novelId: number): boolean {
  if (!Number.isInteger(novelId) || novelId < 1) {
    return false;
  }
  const db = getDb();
  if (!db.prepare("SELECT 1 AS found FROM novels WHERE id = ?").get(novelId)) {
    return false;
  }
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO pinned_novels (novel_id, sort_order)
       VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM pinned_novels))`,
    )
    .run(novelId);
  return result.changes > 0;
}

export function unpinNovel(novelId: number): boolean {
  if (!Number.isInteger(novelId) || novelId < 1) {
    return false;
  }
  return getDb().prepare("DELETE FROM pinned_novels WHERE novel_id = ?").run(novelId).changes > 0;
}

export function togglePinnedNovel(novelId: number): boolean {
  if (isNovelPinned(novelId)) {
    unpinNovel(novelId);
    return false;
  }
  return pinNovel(novelId);
}

export function replacePinnedNovels(novelIds: number[]): number {
  const ids = Array.from(new Set(novelIds.filter((id) => Number.isInteger(id) && id > 0)));
  const db = getDb();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(", ");
    const existing = db
      .prepare(`SELECT id FROM novels WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: number }>;
    if (existing.length !== ids.length) {
      throw new Error("置顶列表中包含不存在的小说");
    }
  }

  const upsert = db.prepare(
    `INSERT INTO pinned_novels (novel_id, sort_order)
     VALUES (?, ?)
     ON CONFLICT(novel_id) DO UPDATE SET
       sort_order = excluded.sort_order,
       updated_at = CURRENT_TIMESTAMP`,
  );
  db.exec("BEGIN");
  try {
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      db.prepare(`DELETE FROM pinned_novels WHERE novel_id NOT IN (${placeholders})`).run(...ids);
    } else {
      db.prepare("DELETE FROM pinned_novels").run();
    }
    ids.forEach((id, index) => upsert.run(id, (index + 1) * 10));
    db.exec("COMMIT");
    return ids.length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
