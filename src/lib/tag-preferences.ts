import { getDb } from "./db";
import type { Tag } from "./tags";

export function listExplicitlyHiddenTagIds(userId: number): Set<number> {
  const rows = getDb()
    .prepare("SELECT tag_id FROM user_hidden_tags WHERE user_id = ?")
    .all(userId) as Array<{ tag_id: number }>;
  return new Set(rows.map((row) => row.tag_id));
}

export function listEffectivelyHiddenTagIds(userId: number): Set<number> {
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE hidden(id) AS (
         SELECT tag_id FROM user_hidden_tags WHERE user_id = ?
         UNION
         SELECT t.id FROM tags t INNER JOIN hidden h ON t.parent_id = h.id
       )
       SELECT id FROM hidden`,
    )
    .all(userId) as Array<{ id: number }>;
  return new Set(rows.map((row) => row.id));
}

export function setUserTagHidden(userId: number, tagId: number, hidden: boolean): boolean {
  const db = getDb();
  if (!db.prepare("SELECT 1 AS found FROM tags WHERE id = ?").get(tagId)) {
    return false;
  }
  if (hidden) {
    db.prepare("INSERT OR IGNORE INTO user_hidden_tags (user_id, tag_id) VALUES (?, ?)").run(userId, tagId);
  } else {
    db.prepare("DELETE FROM user_hidden_tags WHERE user_id = ? AND tag_id = ?").run(userId, tagId);
  }
  return true;
}

export function replaceUserHiddenTags(userId: number, tagIds: readonly number[]): number[] {
  const db = getDb();
  const uniqueIds = [...new Set(tagIds.filter((tagId) => Number.isInteger(tagId) && tagId > 0))].slice(0, 1_000);
  const validIds = uniqueIds.length
    ? (db
        .prepare(`SELECT id FROM tags WHERE id IN (${uniqueIds.map(() => "?").join(",")}) ORDER BY id ASC`)
        .all(...uniqueIds) as Array<{ id: number }>).map((row) => row.id)
    : [];

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM user_hidden_tags WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO user_hidden_tags (user_id, tag_id) VALUES (?, ?)");
    for (const tagId of validIds) insert.run(userId, tagId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return validIds;
}

export function filterTagsForUser<T extends Tag>(tags: readonly T[], userId: number | null | undefined): T[] {
  if (!userId || !tags.length) return [...tags];
  const hidden = listEffectivelyHiddenTagIds(userId);
  return tags.filter((tag) => !hidden.has(tag.id));
}

export function filterTagsByNovelForUser<T extends Tag>(
  tagsByNovel: ReadonlyMap<number, T[]>,
  userId: number | null | undefined,
): Map<number, T[]> {
  if (!userId || tagsByNovel.size === 0) return new Map(tagsByNovel);
  const hidden = listEffectivelyHiddenTagIds(userId);
  return new Map(
    [...tagsByNovel].map(([novelId, tags]) => [novelId, tags.filter((tag) => !hidden.has(tag.id))]),
  );
}
