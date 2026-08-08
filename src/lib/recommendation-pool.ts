import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { sampleNovelIdsFromList } from "./novel-id-sampler";

export const RECOMMENDATION_POOL_MAX_NOVELS = 10_000;

export function listRecommendationPoolNovelIds(db: DatabaseSync = getDb(), sourceId?: number | null): number[] {
  if (Number.isInteger(sourceId) && Number(sourceId) > 0) {
    return (
      db.prepare(
        `SELECT p.novel_id AS novel_id
         FROM novel_recommendation_pool p
         INNER JOIN novels n ON n.id = p.novel_id
         WHERE n.source_id = ?
         ORDER BY p.novel_id ASC`,
      ).all(sourceId) as Array<{ novel_id: number }>
    ).map((row) => row.novel_id);
  }
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
    if (
      !db.prepare("SELECT 1 AS found FROM novel_recommendation_pool WHERE novel_id = ?").get(novelId) &&
      countRecommendationPoolNovels() >= RECOMMENDATION_POOL_MAX_NOVELS
    ) {
      throw new Error(`推荐池最多收录 ${RECOMMENDATION_POOL_MAX_NOVELS} 本小说`);
    }
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
  sourceId?: number | null,
): number[] {
  return sampleNovelIdsFromList(
    listRecommendationPoolNovelIds(db, sourceId),
    count,
    seed,
    excludedIds,
  );
}
