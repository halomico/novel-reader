import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import {
  normalizeNovelSourceSearchModes,
  readSiteSettings,
  type NovelSourceSearchMode,
  writeSiteSettings,
} from "./site-settings";

const SQLITE_ID_CHUNK_SIZE = 400;

function normalizeSourceSlug(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").slice(0, 64);
}

export function getNovelSourceSearchMode(sourceSlug: string): NovelSourceSearchMode {
  const slug = normalizeSourceSlug(sourceSlug);
  return readSiteSettings().novelSourceSearchModes[slug] === "book" ? "book" : "full";
}

export function isNovelSourceFullTextSearchEnabled(sourceSlug: string): boolean {
  return getNovelSourceSearchMode(sourceSlug) === "full";
}

export function setNovelSourceSearchMode(sourceSlug: string, mode: NovelSourceSearchMode) {
  const slug = normalizeSourceSlug(sourceSlug);
  if (!slug) {
    throw new Error("小说来源不存在");
  }

  const settings = readSiteSettings();
  const modes = { ...settings.novelSourceSearchModes };
  if (mode === "book") {
    modes[slug] = "book";
  } else {
    delete modes[slug];
  }
  writeSiteSettings({ ...settings, novelSourceSearchModes: normalizeNovelSourceSearchModes(modes) });
}

export function removeNovelSourceSearchMode(sourceSlug: string) {
  setNovelSourceSearchMode(sourceSlug, "full");
}

export function listFullTextSearchNovelIds(db: DatabaseSync = getDb()): number[] {
  const excludedSlugs = Object.entries(readSiteSettings().novelSourceSearchModes)
    .filter(([, mode]) => mode === "book")
    .map(([slug]) => slug);
  if (!excludedSlugs.length) {
    return (db.prepare("SELECT id FROM novels ORDER BY id ASC").all() as Array<{ id: number }>)
      .map((row) => row.id);
  }

  const excludedSourceIds = new Set<number>();
  for (let offset = 0; offset < excludedSlugs.length; offset += SQLITE_ID_CHUNK_SIZE) {
    const chunk = excludedSlugs.slice(offset, offset + SQLITE_ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db.prepare(
      `SELECT id FROM novel_sources WHERE lower(slug) IN (${placeholders})`,
    ).all(...chunk) as Array<{ id: number }>;
    rows.forEach((row) => excludedSourceIds.add(row.id));
  }
  if (!excludedSourceIds.size) {
    return (db.prepare("SELECT id FROM novels ORDER BY id ASC").all() as Array<{ id: number }>)
      .map((row) => row.id);
  }

  const excludedIds = Array.from(excludedSourceIds);
  const placeholders = excludedIds.map(() => "?").join(", ");
  return (db.prepare(
    `SELECT id FROM novels WHERE source_id IS NULL OR source_id NOT IN (${placeholders}) ORDER BY id ASC`,
  ).all(...excludedIds) as Array<{ id: number }>).map((row) => row.id);
}
