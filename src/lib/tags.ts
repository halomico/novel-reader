import { getDb } from "./db";
import type { Novel } from "./books";

export type TagVisibility = "public" | "member" | "hidden";
export type TagAudience = "public" | "member" | "admin";

export type Tag = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string;
  aliases: string[];
  sortOrder: number;
  visibility: TagVisibility;
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
  visibility: TagVisibility;
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
    visibility: row.visibility,
    isVisible: row.visibility !== "hidden",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveAudience(options: { audience?: TagAudience; includeHidden?: boolean } = {}): TagAudience {
  return options.includeHidden ? "admin" : options.audience || "public";
}

function visibilityCondition(alias: string, audience: TagAudience): string {
  if (audience === "admin") {
    return "1 = 1";
  }
  return audience === "member"
    ? `${alias}.visibility IN ('public', 'member')`
    : `${alias}.visibility = 'public'`;
}

function normalizeTagVisibility(value: unknown, legacyVisible?: boolean): TagVisibility {
  if (value === "member" || value === "hidden") {
    return value;
  }
  if (value === "public") {
    return "public";
  }
  return legacyVisible === false ? "hidden" : "public";
}

function visibilityRank(value: TagVisibility): number {
  return value === "public" ? 0 : value === "member" ? 1 : 2;
}

function clampVisibilityToParent(value: TagVisibility, parentId: number | null): TagVisibility {
  if (!parentId) {
    return value;
  }
  const parent = getDb().prepare("SELECT visibility FROM tags WHERE id = ?").get(parentId) as { visibility: TagVisibility } | undefined;
  return parent && visibilityRank(value) < visibilityRank(parent.visibility) ? parent.visibility : value;
}

function clampDescendantVisibility(parentId: number, visibility: TagVisibility) {
  getDb().prepare(
    `WITH RECURSIVE descendants(id) AS (
       SELECT id FROM tags WHERE parent_id = ?
       UNION ALL
       SELECT t.id FROM tags t INNER JOIN descendants d ON t.parent_id = d.id
     )
     UPDATE tags
     SET visibility = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id IN (SELECT id FROM descendants)
       AND CASE visibility WHEN 'public' THEN 0 WHEN 'member' THEN 1 ELSE 2 END < ?`,
  ).run(parentId, visibility, visibilityRank(visibility));
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
  if (found && currentId > 0) {
    const createsCycle = getDb().prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM tags WHERE parent_id = ?
         UNION ALL
         SELECT t.id FROM tags t INNER JOIN descendants d ON t.parent_id = d.id
       )
       SELECT 1 AS found FROM descendants WHERE id = ?`,
    ).get(currentId, numericValue);
    if (createsCycle) {
      throw new Error("父标签不能选择当前标签的子级");
    }
  }
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

export function listTags(options: { audience?: TagAudience; includeHidden?: boolean } = {}): Tag[] {
  const audience = resolveAudience(options);
  const rows = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, visibility, created_at, updated_at
       FROM tags
       WHERE ${visibilityCondition("tags", audience)}
       ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC`,
    )
    .all() as TagRow[];
  return rows.map(toTag);
}

export function getTagBySlug(slug: string, options: { audience?: TagAudience; includeHidden?: boolean } = {}): Tag | null {
  const audience = resolveAudience(options);
  const row = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, visibility, created_at, updated_at
       FROM tags
       WHERE slug = ? AND ${visibilityCondition("tags", audience)}`,
    )
    .get(slug) as TagRow | undefined;
  return row ? toTag(row) : null;
}

export function listVisibleTagsBySlugs(slugs: string[], options: { audience?: TagAudience } = {}): Tag[] {
  const audience = resolveAudience(options);
  const requested = Array.from(new Set(slugs.map((slug) => slug.trim()).filter(Boolean))).slice(0, 40);
  if (!requested.length) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, visibility, created_at, updated_at
       FROM tags
       WHERE ${visibilityCondition("tags", audience)}
         AND slug IN (${requested.map(() => "?").join(",")})`,
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
  visibility?: TagVisibility;
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
  const visibility = clampVisibilityToParent(normalizeTagVisibility(input.visibility, input.isVisible), parentId);
  const result = getDb()
    .prepare(
      `INSERT INTO tags (parent_id, name, slug, description, aliases, sort_order, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(parentId, name, slug, description, aliases, sortOrder, visibility);
  const created = getDb()
    .prepare(
      `SELECT id, parent_id, name, slug, description, aliases, sort_order, visibility, created_at, updated_at
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
  visibility?: TagVisibility;
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
  const visibility = clampVisibilityToParent(normalizeTagVisibility(input.visibility, input.isVisible), parentId);
  const db = getDb();
  db.exec("BEGIN");
  let changed = 0;
  try {
    changed = Number(db
      .prepare(
        `UPDATE tags
         SET parent_id = ?, name = ?, slug = ?, description = ?, aliases = ?, sort_order = ?, visibility = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(parentId, name, slug, description, aliases, sortOrder, visibility, id).changes);
    clampDescendantVisibility(id, visibility);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return changed > 0;
}

export function deleteTag(id: number): boolean {
  const result = getDb().prepare("DELETE FROM tags WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listTagsForNovel(
  novelId: number,
  options: { audience?: TagAudience; includeHidden?: boolean } = {},
): Tag[] {
  const audience = resolveAudience(options);
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.parent_id, t.name, t.slug, t.description, t.aliases, t.sort_order, t.visibility, t.created_at, t.updated_at
       FROM tags t
       INNER JOIN novel_tags nt ON nt.tag_id = t.id
       WHERE nt.novel_id = ? AND ${visibilityCondition("t", audience)}
       ORDER BY t.sort_order ASC, t.name COLLATE NOCASE ASC, t.id ASC`,
    )
    .all(novelId) as TagRow[];
  return rows.map(toTag);
}

export function listTagsForNovels(
  novelIds: number[],
  options: { audience?: TagAudience; includeHidden?: boolean } = {},
): Map<number, Tag[]> {
  const audience = resolveAudience(options);
  const uniqueIds = Array.from(new Set(novelIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) {
    return new Map();
  }

  const rows = getDb()
    .prepare(
      `SELECT nt.novel_id, t.id, t.parent_id, t.name, t.slug, t.description, t.aliases, t.sort_order, t.visibility, t.created_at, t.updated_at
       FROM novel_tags nt
       INNER JOIN tags t ON t.id = nt.tag_id
       WHERE nt.novel_id IN (${uniqueIds.map(() => "?").join(",")})
         AND ${visibilityCondition("t", audience)}
       ORDER BY nt.novel_id ASC, t.sort_order ASC, t.name COLLATE NOCASE ASC, t.id ASC`,
    )
    .all(...uniqueIds) as Array<TagRow & { novel_id: number }>;
  const tagsByNovel = new Map<number, Tag[]>();
  for (const row of rows) {
    tagsByNovel.set(row.novel_id, [...(tagsByNovel.get(row.novel_id) || []), toTag(row)]);
  }
  return tagsByNovel;
}

function getTagCounts(sourceId?: number): Map<number, number> {
  const sourceFilter = sourceId ? " WHERE n.source_id = ?" : "";
  const sourceValues = sourceId ? [sourceId] : [];
  const rows = getDb()
    .prepare(
      `SELECT nt.tag_id, COUNT(*) AS count
       FROM novel_tags nt
       INNER JOIN novels n ON n.id = nt.novel_id
       ${sourceFilter}
       GROUP BY nt.tag_id`,
    )
    .all(...sourceValues) as Array<{ tag_id: number; count: number }>;
  return new Map(rows.map((row) => [row.tag_id, row.count]));
}

function withCounts(tags: Tag[], counts = getTagCounts()): TagWithCount[] {
  return tags.map((tag) => ({ ...tag, directCount: counts.get(tag.id) || 0 }));
}

export function listTagGroups(options: { audience?: TagAudience; includeHidden?: boolean; sourceId?: number; omitEmpty?: boolean } = {}): TagGroup[] {
  const sourceId = Number.isInteger(options.sourceId) && Number(options.sourceId) > 0 ? Number(options.sourceId) : undefined;
  const tags = withCounts(listTags(options), getTagCounts(sourceId));
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
  if (!options.omitEmpty) return groups;
  return groups.flatMap((group) => {
    const children = group.tags.filter((tag) => tag.directCount > 0);
    return children.length || (group.group?.directCount || 0) > 0 ? [{ ...group, tags: children }] : [];
  });
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

export function listNovelsByTag(
  tagId: number,
  params: { page?: number; pageSize?: number; audience?: TagAudience; sourceId?: number } = {},
): TaggedNovelListResult {
  const db = getDb();
  const audience = resolveAudience(params);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 15), 1), 100);
  const sourceId = Number.isInteger(params.sourceId) && Number(params.sourceId) > 0 ? Number(params.sourceId) : 0;
  const sourceFilter = sourceId ? " AND n.source_id = ?" : "";
  const sourceValues = sourceId ? [sourceId] : [];
  const totalBooks = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM novels n
       INNER JOIN novel_tags nt ON nt.novel_id = n.id
       INNER JOIN tags t ON t.id = nt.tag_id
       WHERE t.id = ? AND ${visibilityCondition("t", audience)}${sourceFilter}`,
    )
    .get(tagId, ...sourceValues) as { count: number };
  const totalPages = Math.max(1, Math.ceil(totalBooks.count / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const books = db
    .prepare(
      `SELECT n.id, n.title, n.file_name, n.relative_path, n.source_id, n.storage_mode, n.chapter_count,
              n.access_mode, n.soda_price, n.preview_chapter_count, n.content_hash, n.size_bytes, n.mtime_ms, n.word_count, n.visit_count,
              n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent, n.created_at, n.updated_at
       FROM novels n
       INNER JOIN novel_tags nt ON nt.novel_id = n.id
       INNER JOIN tags t ON t.id = nt.tag_id
       WHERE t.id = ? AND ${visibilityCondition("t", audience)}${sourceFilter}
       ORDER BY n.title COLLATE NOCASE ASC, n.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(tagId, ...sourceValues, pageSize, (page - 1) * pageSize) as Novel[];
  return {
    books,
    page,
    pageSize,
    totalBooks: totalBooks.count,
    totalPages,
  };
}

function resolveVisibleTagFilterIds(tagIds: number[], excludeTagIds: number[] = [], audience: TagAudience = "public") {
  const db = getDb();
  const requestedIds = Array.from(new Set(tagIds.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 20);
  const validIds = requestedIds.length
    ? (db
        .prepare(`SELECT id FROM tags WHERE ${visibilityCondition("tags", audience)} AND id IN (${requestedIds.map(() => "?").join(",")})`)
        .all(...requestedIds) as Array<{ id: number }>).map((row) => row.id)
    : [];
  const requestedExcludedIds = Array.from(new Set(
    excludeTagIds.filter((id) => Number.isInteger(id) && id > 0 && !validIds.includes(id)),
  )).slice(0, 20);
  const validExcludedIds = requestedExcludedIds.length
    ? (db
        .prepare(`SELECT id FROM tags WHERE ${visibilityCondition("tags", audience)} AND id IN (${requestedExcludedIds.map(() => "?").join(",")})`)
        .all(...requestedExcludedIds) as Array<{ id: number }>).map((row) => row.id)
    : [];
  return { validIds, validExcludedIds, hasInvalidIncluded: requestedIds.length !== validIds.length };
}

export function listNovelsByTagIntersection(
  tagIds: number[],
  params: { page?: number; pageSize?: number; q?: string; excludeTagIds?: number[]; audience?: TagAudience; sourceId?: number } = {},
): TagIntersectionListResult {
  const db = getDb();
  const audience = resolveAudience(params);
  const { validIds, validExcludedIds, hasInvalidIncluded } = resolveVisibleTagFilterIds(tagIds, params.excludeTagIds, audience);
  const query = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const sourceId = Number.isInteger(params.sourceId) && Number(params.sourceId) > 0 ? Number(params.sourceId) : 0;
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 15), 1), 100);
  if (hasInvalidIncluded || (!validIds.length && !query && !sourceId)) {
    return { books: [], page: 1, pageSize, totalBooks: 0, totalPages: 1, tagIds: validIds, excludedTagIds: validExcludedIds, query };
  }

  const placeholders = validIds.map(() => "?").join(",");
  const includeJoin = validIds.length ? "INNER JOIN novel_tags nt ON nt.novel_id = n.id" : "";
  const includeFilter = validIds.length ? `nt.tag_id IN (${placeholders})` : "1 = 1";
  const titleFilter = query ? "AND instr(lower(n.title), lower(?)) > 0" : "";
  const sourceFilter = sourceId ? "AND n.source_id = ?" : "";
  const excludedFilter = validExcludedIds.length
    ? `AND NOT EXISTS (
         SELECT 1 FROM novel_tags excluded
         WHERE excluded.novel_id = n.id AND excluded.tag_id IN (${validExcludedIds.map(() => "?").join(",")})
       )`
    : "";
  const includeGrouping = validIds.length
    ? "GROUP BY n.id HAVING COUNT(DISTINCT nt.tag_id) = ?"
    : "";
  const filterParams: Array<string | number> = [
    ...validIds,
    ...(query ? [query] : []),
    ...(sourceId ? [sourceId] : []),
    ...validExcludedIds,
    ...(validIds.length ? [validIds.length] : []),
  ];
  const total = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT n.id
         FROM novels n
         ${includeJoin}
         WHERE ${includeFilter} ${titleFilter} ${sourceFilter} ${excludedFilter}
         ${includeGrouping}
       )`,
    )
    .get(...filterParams) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const books = db
    .prepare(
      `SELECT n.id, n.title, n.file_name, n.relative_path, n.source_id, n.storage_mode, n.chapter_count,
              n.access_mode, n.soda_price, n.preview_chapter_count, n.content_hash, n.size_bytes, n.mtime_ms, n.word_count, n.visit_count,
              n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent, n.created_at, n.updated_at
       FROM novels n
       ${includeJoin}
       WHERE ${includeFilter} ${titleFilter} ${sourceFilter} ${excludedFilter}
       ${includeGrouping}
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
  params: { q?: string; excludeTagIds?: number[]; audience?: TagAudience; sourceId?: number } = {},
): number[] {
  const audience = resolveAudience(params);
  const { validIds, validExcludedIds, hasInvalidIncluded } = resolveVisibleTagFilterIds(tagIds, params.excludeTagIds, audience);
  const query = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const sourceId = Number.isInteger(params.sourceId) && Number(params.sourceId) > 0 ? Number(params.sourceId) : 0;
  if (hasInvalidIncluded || (!validIds.length && !query && !validExcludedIds.length && !sourceId)) return [];

  const includePlaceholders = validIds.map(() => "?").join(",");
  const includeJoin = validIds.length ? "INNER JOIN novel_tags nt ON nt.novel_id = n.id" : "";
  const includeFilter = validIds.length ? `nt.tag_id IN (${includePlaceholders})` : "1 = 1";
  const titleFilter = query ? "AND instr(lower(n.title), lower(?)) > 0" : "";
  const sourceFilter = sourceId ? "AND n.source_id = ?" : "";
  const excludedFilter = validExcludedIds.length
    ? `AND NOT EXISTS (
         SELECT 1 FROM novel_tags excluded
         WHERE excluded.novel_id = n.id AND excluded.tag_id IN (${validExcludedIds.map(() => "?").join(",")})
       )`
    : "";
  const includeGrouping = validIds.length
    ? "GROUP BY n.id HAVING COUNT(DISTINCT nt.tag_id) = ?"
    : "";
  const paramsList: Array<string | number> = [
    ...validIds,
    ...(query ? [query] : []),
    ...(sourceId ? [sourceId] : []),
    ...validExcludedIds,
    ...(validIds.length ? [validIds.length] : []),
  ];
  const rows = getDb()
    .prepare(
      `SELECT n.id
       FROM novels n
       ${includeJoin}
       WHERE ${includeFilter} ${titleFilter} ${sourceFilter} ${excludedFilter}
       ${includeGrouping}
       ORDER BY n.id ASC`,
    )
    .all(...paramsList) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}
