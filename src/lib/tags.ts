import { getDb } from "./db";
import type { Novel } from "./books";

export type Tag = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string;
  aliases: string[];
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TaggedNovelListResult = {
  books: Novel[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalPages: number;
};

export type TagIntersectionListResult = TaggedNovelListResult & {
  tagIds: number[];
  excludedTagIds: number[];
  query: string;
};

export type TagWithCount = Tag & {
  directCount: number;
};

export type TagGroup = {
  group: TagWithCount | null;
  tags: TagWithCount[];
};

const MAX_TAG_NAME_LENGTH = 40;
const MAX_TAG_DESCRIPTION_LENGTH = 240;
const MAX_TAG_ALIAS_COUNT = 20;
const MAX_TAG_SLUG_LENGTH = 64;
const MAX_HOTWORD_COUNT = 24;
const MAX_HOTWORD_CHARS = 15;

type TagRow = {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string;
  aliases: string;
  sort_order: number;
  is_visible: number;
  created_at: string;
  updated_at: string;
};

function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    aliases: parseStoredAliases(row.aliases),
    sortOrder: row.sort_order,
    isVisible: row.is_visible === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStoredAliases(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseTagAliases(value: string | string[] | null | undefined, tagName = ""): string[] {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,，、]+/u);
  const canonical = normalizeTagName(tagName).toLocaleLowerCase();
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const item of source) {
    const alias = normalizeTagName(item);
    const normalized = alias.toLocaleLowerCase();
    if (!alias || normalized === canonical || seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(alias);
    if (aliases.length >= MAX_TAG_ALIAS_COUNT) break;
  }
  return aliases;
}

function normalizeParentId(value: number | string | null | undefined, currentId = 0): number | null {
  const numericValue = Number(value || 0);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue === currentId) {
    return null;
  }
  const found = getDb().prepare("SELECT 1 AS found FROM tags WHERE id = ?").get(numericValue);
  return found ? numericValue : null;
}

function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_NAME_LENGTH);
}

export function normalizeTagSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_TAG_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

function normalizeSortOrder(value: number | string | undefined): number {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(numericValue), -9999), 9999);
}

function ensureUniqueSlug(base: string, exceptId = 0): string {
  const db = getDb();
  const normalizedBase = normalizeTagSlug(base) || "tag";
  let candidate = normalizedBase;
  let suffix = 2;
  while (
    db
      .prepare("SELECT 1 AS found FROM tags WHERE slug = ? AND id <> ?")
      .get(candidate, exceptId)
  ) {
    const suffixText = `-${suffix}`;
    candidate = `${normalizedBase.slice(0, MAX_TAG_SLUG_LENGTH - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

export function listTags(options: { includeHidden?: boolean } = {}): Tag[] {
  const rows = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, is_visible, created_at, updated_at
       FROM tags
       ${options.includeHidden ? "" : "WHERE is_visible = 1"}
       ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC`,
    )
    .all() as TagRow[];
  return rows.map(toTag);
}

export function getTagBySlug(slug: string): Tag | null {
  const row = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, is_visible, created_at, updated_at
       FROM tags
       WHERE slug = ? AND is_visible = 1`,
    )
    .get(slug) as TagRow | undefined;
  return row ? toTag(row) : null;
}

export function listVisibleTagsBySlugs(slugs: string[]): Tag[] {
  const requested = Array.from(new Set(slugs.map((slug) => slug.trim()).filter(Boolean))).slice(0, 40);
  if (!requested.length) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, is_visible, created_at, updated_at
       FROM tags
       WHERE is_visible = 1 AND slug IN (${requested.map(() => "?").join(",")})`,
    )
    .all(...requested) as TagRow[];
  const bySlug = new Map(rows.map((row) => [row.slug, toTag(row)]));
  return requested.flatMap((slug) => bySlug.get(slug) || []);
}

export function createTag(input: {
  name: string;
  parentId?: number | string | null;
  slug?: string;
  description?: string;
  aliases?: string | string[];
  sortOrder?: number | string;
  isVisible?: boolean;
}): Tag {
  const name = normalizeTagName(input.name);
  if (!name) {
    throw new Error("标签名称不能为空");
  }
  const slug = ensureUniqueSlug(input.slug || name);
  const parentId = normalizeParentId(input.parentId);
  const description = (input.description || "").trim().slice(0, MAX_TAG_DESCRIPTION_LENGTH);
  const aliases = JSON.stringify(parseTagAliases(input.aliases, name));
  const sortOrder = normalizeSortOrder(input.sortOrder);
  const visible = input.isVisible === false ? 0 : 1;
  const result = getDb()
    .prepare(
      `INSERT INTO tags (parent_id, name, slug, description, aliases, sort_order, is_visible)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(parentId, name, slug, description, aliases, sortOrder, visible);
  const created = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, is_visible, created_at, updated_at
       FROM tags
       WHERE id = ?`,
    )
    .get(result.lastInsertRowid) as TagRow;
  return toTag(created);
}

export function updateTag(input: {
  id: number;
  name: string;
  parentId?: number | string | null;
  slug?: string;
  description?: string;
  aliases?: string | string[];
  sortOrder?: number | string;
  isVisible?: boolean;
}): boolean {
  const id = Number(input.id);
  if (!Number.isInteger(id) || id < 1) {
    return false;
  }
  const name = normalizeTagName(input.name);
  if (!name) {
    throw new Error("标签名称不能为空");
  }
  const slug = ensureUniqueSlug(input.slug || name, id);
  const parentId = normalizeParentId(input.parentId, id);
  const description = (input.description || "").trim().slice(0, MAX_TAG_DESCRIPTION_LENGTH);
  const aliases = JSON.stringify(parseTagAliases(input.aliases, name));
  const sortOrder = normalizeSortOrder(input.sortOrder);
  const visible = input.isVisible === false ? 0 : 1;
  const result = getDb()
    .prepare(
      `UPDATE tags
       SET parent_id = ?, name = ?, slug = ?, description = ?, aliases = ?, sort_order = ?, is_visible = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(parentId, name, slug, description, aliases, sortOrder, visible, id);
  return result.changes > 0;
}

export function deleteTag(id: number): boolean {
  const result = getDb().prepare("DELETE FROM tags WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listTagsForNovel(novelId: number, options: { includeHidden?: boolean } = {}): Tag[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.parent_id, t.name, t.slug, t.description, t.aliases, t.sort_order, t.is_visible, t.created_at, t.updated_at
       FROM tags t
       INNER JOIN novel_tags nt ON nt.tag_id = t.id
       WHERE nt.novel_id = ? ${options.includeHidden ? "" : "AND t.is_visible = 1"}
       ORDER BY t.sort_order ASC, t.name COLLATE NOCASE ASC, t.id ASC`,
    )
    .all(novelId) as TagRow[];
  return rows.map(toTag);
}

export function listTagsForNovels(novelIds: number[], options: { includeHidden?: boolean } = {}): Map<number, Tag[]> {
  const uniqueIds = Array.from(new Set(novelIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) {
    return new Map();
  }

  const rows = getDb()
    .prepare(
      `SELECT nt.novel_id, t.id, t.parent_id, t.name, t.slug, t.description, t.aliases, t.sort_order, t.is_visible, t.created_at, t.updated_at
       FROM novel_tags nt
       INNER JOIN tags t ON t.id = nt.tag_id
       WHERE nt.novel_id IN (${uniqueIds.map(() => "?").join(",")}) ${options.includeHidden ? "" : "AND t.is_visible = 1"}
       ORDER BY nt.novel_id ASC, t.sort_order ASC, t.name COLLATE NOCASE ASC, t.id ASC`,
    )
    .all(...uniqueIds) as Array<TagRow & { novel_id: number }>;
  const tagsByNovel = new Map<number, Tag[]>();
  for (const row of rows) {
    tagsByNovel.set(row.novel_id, [...(tagsByNovel.get(row.novel_id) || []), toTag(row)]);
  }
  return tagsByNovel;
}

function getTagCounts(): Map<number, number> {
  const rows = getDb()
    .prepare(
      `SELECT tag_id, COUNT(*) AS count
       FROM novel_tags
       GROUP BY tag_id`,
    )
    .all() as Array<{ tag_id: number; count: number }>;
  return new Map(rows.map((row) => [row.tag_id, row.count]));
}

function withCounts(tags: Tag[], counts = getTagCounts()): TagWithCount[] {
  return tags.map((tag) => ({ ...tag, directCount: counts.get(tag.id) || 0 }));
}

export function listTagGroups(options: { includeHidden?: boolean } = {}): TagGroup[] {
  const tags = withCounts(listTags(options));
  const byParent = new Map<number, TagWithCount[]>();
  const roots: TagWithCount[] = [];
  for (const tag of tags) {
    if (tag.parentId) {
      byParent.set(tag.parentId, [...(byParent.get(tag.parentId) || []), tag]);
    } else {
      roots.push(tag);
    }
  }

  const groups: TagGroup[] = roots.map((group) => ({ group, tags: byParent.get(group.id) || [] }));
  const rootIds = new Set(roots.map((tag) => tag.id));
  const orphaned = tags.filter((tag) => tag.parentId && !rootIds.has(tag.parentId));
  if (orphaned.length) {
    groups.push({ group: null, tags: orphaned });
  }
  return groups;
}

export function setNovelTags(novelId: number, tagIds: number[]): number {
  const db = getDb();
  const uniqueIds = Array.from(new Set(tagIds.filter((id) => Number.isInteger(id) && id > 0)));
  const validIds = uniqueIds.length
    ? (db
        .prepare(`SELECT id FROM tags WHERE id IN (${uniqueIds.map(() => "?").join(",")})`)
        .all(...uniqueIds) as Array<{ id: number }>).map((row) => row.id)
    : [];

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM novel_tags WHERE novel_id = ?").run(novelId);
    const insert = db.prepare("INSERT OR IGNORE INTO novel_tags (novel_id, tag_id) VALUES (?, ?)");
    for (const tagId of validIds) {
      insert.run(novelId, tagId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return validIds.length;
}

export function parseHotwordInput(value: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const rawTerm of value.split(/[\n,，、]+/)) {
    const term = rawTerm.trim().replace(/\s+/g, " ");
    if (!term || seen.has(term)) {
      continue;
    }
    if (Array.from(term).length > MAX_HOTWORD_CHARS) {
      throw new Error("热词不能超过 15 字");
    }
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_HOTWORD_COUNT) {
      break;
    }
  }
  return terms;
}

export function listHotwordsForNovel(novelId: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT term
       FROM novel_hotwords
       WHERE novel_id = ?
       ORDER BY sort_order ASC, term COLLATE NOCASE ASC`,
    )
    .all(novelId) as Array<{ term: string }>;
  return rows.map((row) => row.term);
}

export function setNovelHotwords(novelId: number, terms: string[]): number {
  const db = getDb();
  const normalizedTerms = parseHotwordInput(terms.join("\n"));
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM novel_hotwords WHERE novel_id = ?").run(novelId);
    const insert = db.prepare("INSERT INTO novel_hotwords (novel_id, term, sort_order) VALUES (?, ?, ?)");
    normalizedTerms.forEach((term, index) => insert.run(novelId, term, index));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return normalizedTerms.length;
}

function normalizePage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

export function listNovelsByTag(tagId: number, params: { page?: number; pageSize?: number } = {}): TaggedNovelListResult {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 15), 1), 100);
  const totalBooks = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM novels n
       INNER JOIN novel_tags nt ON nt.novel_id = n.id
       INNER JOIN tags t ON t.id = nt.tag_id
       WHERE t.id = ? AND t.is_visible = 1`,
    )
    .get(tagId) as { count: number };
  const totalPages = Math.max(1, Math.ceil(totalBooks.count / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const books = db
    .prepare(
      `SELECT n.id, n.title, n.file_name, n.relative_path, n.content_hash, n.size_bytes, n.mtime_ms, n.word_count, n.visit_count,
              n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent, n.created_at, n.updated_at
       FROM novels n
       INNER JOIN novel_tags nt ON nt.novel_id = n.id
       INNER JOIN tags t ON t.id = nt.tag_id
       WHERE t.id = ? AND t.is_visible = 1
       ORDER BY n.title COLLATE NOCASE ASC, n.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(tagId, pageSize, (page - 1) * pageSize) as Novel[];
  return {
    books,
    page,
    pageSize,
    totalBooks: totalBooks.count,
    totalPages,
  };
}

function resolveVisibleTagFilterIds(tagIds: number[], excludeTagIds: number[] = []) {
  const db = getDb();
  const requestedIds = Array.from(new Set(tagIds.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 20);
  const validIds = requestedIds.length
    ? (db
        .prepare(`SELECT id FROM tags WHERE is_visible = 1 AND id IN (${requestedIds.map(() => "?").join(",")})`)
        .all(...requestedIds) as Array<{ id: number }>).map((row) => row.id)
    : [];
  const requestedExcludedIds = Array.from(new Set(
    excludeTagIds.filter((id) => Number.isInteger(id) && id > 0 && !validIds.includes(id)),
  )).slice(0, 20);
  const validExcludedIds = requestedExcludedIds.length
    ? (db
        .prepare(`SELECT id FROM tags WHERE is_visible = 1 AND id IN (${requestedExcludedIds.map(() => "?").join(",")})`)
        .all(...requestedExcludedIds) as Array<{ id: number }>).map((row) => row.id)
    : [];
  return { validIds, validExcludedIds, hasInvalidIncluded: requestedIds.length !== validIds.length };
}

export function listNovelsByTagIntersection(
  tagIds: number[],
  params: { page?: number; pageSize?: number; q?: string; excludeTagIds?: number[] } = {},
): TagIntersectionListResult {
  const db = getDb();
  const { validIds, validExcludedIds, hasInvalidIncluded } = resolveVisibleTagFilterIds(tagIds, params.excludeTagIds);
  const query = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 15), 1), 100);
  if (!validIds.length || hasInvalidIncluded) {
    return { books: [], page: 1, pageSize, totalBooks: 0, totalPages: 1, tagIds: validIds, excludedTagIds: validExcludedIds, query };
  }

  const placeholders = validIds.map(() => "?").join(",");
  const titleFilter = query ? "AND instr(lower(n.title), lower(?)) > 0" : "";
  const excludedFilter = validExcludedIds.length
    ? `AND NOT EXISTS (
         SELECT 1 FROM novel_tags excluded
         WHERE excluded.novel_id = n.id AND excluded.tag_id IN (${validExcludedIds.map(() => "?").join(",")})
       )`
    : "";
  const filterParams: Array<string | number> = [
    ...validIds,
    ...(query ? [query] : []),
    ...validExcludedIds,
    validIds.length,
  ];
  const total = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT n.id
         FROM novels n
         INNER JOIN novel_tags nt ON nt.novel_id = n.id
         WHERE nt.tag_id IN (${placeholders}) ${titleFilter} ${excludedFilter}
         GROUP BY n.id
         HAVING COUNT(DISTINCT nt.tag_id) = ?
       )`,
    )
    .get(...filterParams) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const books = db
    .prepare(
      `SELECT n.id, n.title, n.file_name, n.relative_path, n.content_hash, n.size_bytes, n.mtime_ms, n.word_count, n.visit_count,
              n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent, n.created_at, n.updated_at
       FROM novels n
       INNER JOIN novel_tags nt ON nt.novel_id = n.id
       WHERE nt.tag_id IN (${placeholders}) ${titleFilter} ${excludedFilter}
       GROUP BY n.id
       HAVING COUNT(DISTINCT nt.tag_id) = ?
       ORDER BY n.title COLLATE NOCASE ASC, n.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...filterParams, pageSize, (page - 1) * pageSize) as Novel[];

  return {
    books,
    page,
    pageSize,
    totalBooks: total.count,
    totalPages,
    tagIds: validIds,
    excludedTagIds: validExcludedIds,
    query,
  };
}

export function listNovelIdsByTagFilters(
  tagIds: number[],
  params: { q?: string; excludeTagIds?: number[] } = {},
): number[] {
  const { validIds, validExcludedIds, hasInvalidIncluded } = resolveVisibleTagFilterIds(tagIds, params.excludeTagIds);
  if (!validIds.length || hasInvalidIncluded) return [];
  const query = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);

  const includePlaceholders = validIds.map(() => "?").join(",");
  const titleFilter = query ? "AND instr(lower(n.title), lower(?)) > 0" : "";
  const excludedFilter = validExcludedIds.length
    ? `AND NOT EXISTS (
         SELECT 1 FROM novel_tags excluded
         WHERE excluded.novel_id = n.id AND excluded.tag_id IN (${validExcludedIds.map(() => "?").join(",")})
       )`
    : "";
  const paramsList: Array<string | number> = [
    ...validIds,
    ...(query ? [query] : []),
    ...validExcludedIds,
    validIds.length,
  ];
  const rows = getDb()
    .prepare(
      `SELECT n.id
       FROM novels n
       INNER JOIN novel_tags nt ON nt.novel_id = n.id
       WHERE nt.tag_id IN (${includePlaceholders}) ${titleFilter} ${excludedFilter}
       GROUP BY n.id
       HAVING COUNT(DISTINCT nt.tag_id) = ?
       ORDER BY n.id ASC`,
    )
    .all(...paramsList) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}
