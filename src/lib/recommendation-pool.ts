import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { sampleNovelIdsFromList } from "./novel-id-sampler";

export function listRecommendationPoolNovelIds(db: DatabaseSync = getDb()): number[] {
  return (
    db.prepare("SELECT novel_id FROM novel_recommendation_pool ORDER BY novel_id ASC").all() as Array<{
      novel_id: number;
    }>
  ).map((row) => row.novel_id);
}

export function countRecommendationPoolNovels(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM novel_recommendation_pool")
    .get() as { count: number };
  return row.count;
}

export function isNovelInRecommendationPool(novelId: number): boolean {
  if (!Number.isInteger(novelId) || novelId < 1) {
    return false;
  }
  return Boolean(
    getDb()
      .prepare("SELECT 1 AS found FROM novel_recommendation_pool WHERE novel_id = ?")
      .get(novelId),
  );
}

export function setNovelRecommendationPool(novelId: number, included: boolean): void {
  if (!Number.isInteger(novelId) || novelId < 1) {
    throw new Error("小说不存在");
  }
  const db = getDb();
  if (!db.prepare("SELECT 1 AS found FROM novels WHERE id = ?").get(novelId)) {
    throw new Error("小说不存在");
  }
  if (included) {
    db.prepare("INSERT OR IGNORE INTO novel_recommendation_pool (novel_id) VALUES (?)").run(novelId);
    return;
  }
  db.prepare("DELETE FROM novel_recommendation_pool WHERE novel_id = ?").run(novelId);
}

export function sampleRecommendationPoolNovelIds(
  db: DatabaseSync,
  count: number,
  seed: string,
  excludedIds: ReadonlySet<number> = new Set(),
): number[] {
  return sampleNovelIdsFromList(
    listRecommendationPoolNovelIds(db),
    count,
    seed,
    excludedIds,
  );
}
