import type { DatabaseSync } from "node:sqlite";
import { getExistingContentSearchDb } from "./content-search-db";
import { deleteContentSearchIndexNovel } from "./content-search-index";
import { getDb } from "./db";

export function invalidateNovelContentSearchIndex(novelId: number, mainDb: DatabaseSync = getDb()) {
  if (!Number.isInteger(novelId) || novelId < 1) return;
  const row = mainDb.prepare("SELECT source_id AS sourceId FROM novels WHERE id = ?").get(novelId) as
    | { sourceId: number | null }
    | undefined;
  if (!row || !Number.isInteger(row.sourceId) || Number(row.sourceId) < 1) return;
  const searchDb = getExistingContentSearchDb(Number(row.sourceId));
  if (searchDb) deleteContentSearchIndexNovel(searchDb, novelId);
}
