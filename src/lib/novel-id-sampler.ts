import type { DatabaseSync } from "node:sqlite";

type NovelIdCache = {
  db: DatabaseSync;
  expiresAt: number;
  ids: number[];
};

type NovelIdCacheGlobal = typeof globalThis & {
  novelIdCache?: NovelIdCache;
};

const NOVEL_ID_CACHE_TTL_MS = 5 * 60 * 1_000;

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleIndexes(length: number, count: number, random: () => number): number[] {
  const swaps = new Map<number, number>();
  const sampled: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const pickedIndex = index + Math.floor(random() * (length - index));
    const valueAtIndex = swaps.get(index) ?? index;
    const valueAtPickedIndex = swaps.get(pickedIndex) ?? pickedIndex;
    swaps.set(index, valueAtPickedIndex);
    swaps.set(pickedIndex, valueAtIndex);
    sampled.push(valueAtPickedIndex);
  }
  return sampled;
}

export function sampleNovelIdsFromList(
  ids: readonly number[],
  count: number,
  seed: string,
  excludedIds: ReadonlySet<number> = new Set(),
): number[] {
  const target = Math.min(Math.max(Math.floor(count), 0), ids.length);
  if (!target || !ids.length) {
    return [];
  }

  const candidateCount = Math.min(ids.length, target + excludedIds.size);
  const random = seededRandom(seed);
  return sampleIndexes(ids.length, candidateCount, random)
    .map((index) => ids[index])
    .filter((id) => !excludedIds.has(id))
    .slice(0, target);
}

function getCachedNovelIds(db: DatabaseSync): number[] {
  const state = globalThis as NovelIdCacheGlobal;
  const now = Date.now();
  if (state.novelIdCache?.db === db && state.novelIdCache.expiresAt > now) {
    return state.novelIdCache.ids;
  }

  const ids = (db.prepare("SELECT id FROM novels ORDER BY id ASC").all() as Array<{ id: number }>).map((row) => row.id);
  state.novelIdCache = { db, ids, expiresAt: now + NOVEL_ID_CACHE_TTL_MS };
  return ids;
}

export function sampleNovelIds(
  db: DatabaseSync,
  count: number,
  seed: string,
  excludedIds: ReadonlySet<number> = new Set(),
): number[] {
  return sampleNovelIdsFromList(getCachedNovelIds(db), count, seed, excludedIds);
}

export function invalidateNovelIdCache() {
  delete (globalThis as NovelIdCacheGlobal).novelIdCache;
}
