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

export function movePinnedNovel(novelId: number, direction: "up" | "down"): boolean {
  const db = getDb();
  const rows = db
    .prepare("SELECT novel_id FROM pinned_novels ORDER BY sort_order ASC, novel_id ASC")
    .all() as Array<{ novel_id: number }>;
  const ids = rows.map((row) => row.novel_id);
  const index = ids.indexOf(novelId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) {
    return false;
  }

  [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
  const update = db.prepare("UPDATE pinned_novels SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE novel_id = ?");
  db.exec("BEGIN");
  try {
    ids.forEach((id, orderIndex) => update.run((orderIndex + 1) * 10, id));
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
