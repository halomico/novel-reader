import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import type { PublicTagAudience, PublicTagVisibility } from "./postgres-catalog";

export type PostgresCatalogTag = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string;
  aliases: string[];
  sortOrder: number;
  visibility: PublicTagVisibility;
  directCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresCatalogTagGroup = {
  group: PostgresCatalogTag | null;
  tags: PostgresCatalogTag[];
};

export type PostgresCatalogTagInput = {
  name: string;
  parentId?: number | string | null;
  slug?: string;
  description?: string;
  aliases?: string | readonly string[];
  sortOrder?: number | string;
  visibility?: PublicTagVisibility;
};

const MAX_TAG_NAME_LENGTH = 40;
const MAX_TAG_DESCRIPTION_LENGTH = 240;
const MAX_TAG_ALIAS_COUNT = 20;
const MAX_TAG_SLUG_LENGTH = 64;
const MAX_HOTWORD_COUNT = 24;
const MAX_HOTWORD_CHARACTERS = 15;

type TagRow = QueryResultRow & {
  id: string | number;
  parent_id: string | number | null;
  name: string;
  slug: string;
  description: string;
  aliases: unknown;
  sort_order: number;
  visibility: PublicTagVisibility;
  direct_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

function positiveInteger(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid ${name}`);
  return parsed;
}

function nonnegativeInteger(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${name}`);
  return parsed;
}

function timestamp(value: Date | string, name: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${name}`);
  return date.toISOString();
}

function aliases(value: unknown): string[] {
  const parsed = typeof value === "string" ? (() => {
    try { return JSON.parse(value) as unknown; } catch { return []; }
  })() : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
}

function normalizedTagName(value: string): string {
  return String(value).normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, MAX_TAG_NAME_LENGTH);
}

export function normalizePostgresTagSlug(value: string): string {
  return String(value).normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-")
    .slice(0, MAX_TAG_SLUG_LENGTH)
    .replace(/-+$/gu, "");
}

// SQLite imports retain legacy slugs with underscores. Keep accepting those
// links while new and edited tags continue to use the normalized hyphen form.
const POSTGRES_TAG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u;

function normalizedAliases(value: string | readonly string[] | undefined, tagName: string): string[] {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,，、]+/u);
  const canonical = tagName.toLocaleLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const alias = normalizedTagName(String(item));
    const key = alias.toLocaleLowerCase();
    if (!alias || key === canonical || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
    if (result.length >= MAX_TAG_ALIAS_COUNT) break;
  }
  return result;
}

function normalizedSortOrder(value: number | string | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), -9_999), 9_999) : 0;
}

function normalizedVisibility(value: PublicTagVisibility | undefined): PublicTagVisibility {
  if (value === "member" || value === "hidden") return value;
  return "public";
}

function optionalParentId(value: number | string | null | undefined, currentId = 0): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parentId = Number(value);
  if (!Number.isSafeInteger(parentId) || parentId < 1 || parentId === currentId) {
    throw new Error("父标签无效");
  }
  return parentId;
}

function visibilityRank(value: PublicTagVisibility): number {
  return value === "public" ? 0 : value === "member" ? 1 : 2;
}

async function resolveTagParent(
  executor: SqlExecutor,
  parentId: number | null,
  currentId = 0,
): Promise<{ id: number; visibility: PublicTagVisibility } | null> {
  if (parentId === null) return null;
  const parent = await executor.query<QueryResultRow & { id: string | number; visibility: PublicTagVisibility }>({
    text: "SELECT id, visibility FROM tags WHERE id = $1 FOR SHARE",
    values: [parentId],
  });
  if (!parent.rows[0]) throw new Error("父标签不存在");
  if (currentId > 0) {
    const cycle = await executor.query<QueryResultRow & { found: boolean }>({
      text: `WITH RECURSIVE descendants(id) AS (
               SELECT id FROM tags WHERE parent_id = $1
               UNION ALL
               SELECT child.id FROM tags child JOIN descendants tree ON child.parent_id = tree.id
             )
             SELECT EXISTS (SELECT 1 FROM descendants WHERE id = $2) AS found`,
      values: [currentId, parentId],
    });
    if (cycle.rows[0]?.found) throw new Error("父标签不能选择当前标签的子级");
  }
  return { id: positiveInteger(parent.rows[0].id, "tag parent id"), visibility: parent.rows[0].visibility };
}

async function uniqueTagSlug(executor: SqlExecutor, source: string, exceptId = 0): Promise<string> {
  const base = normalizePostgresTagSlug(source) || "tag";
  await executor.query({
    text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    values: ["catalog-tag-taxonomy"],
  });
  const existing = await executor.query<QueryResultRow & { slug: string }>({
    text: "SELECT slug FROM tags WHERE id <> $1 ORDER BY slug",
    values: [exceptId],
  });
  const occupied = new Set(existing.rows.map((row) => row.slug));
  if (!occupied.has(base)) return base;
  for (let suffix = 2; suffix <= 1_000_000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_TAG_SLUG_LENGTH - suffixText.length)}${suffixText}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("无法生成唯一标签链接标识");
}

async function readAdminTagById(executor: SqlExecutor, id: number): Promise<PostgresCatalogTag> {
  const result = await executor.query<TagRow>({
    text: `SELECT tag.id, tag.parent_id, tag.name, tag.slug, tag.description,
             tag.aliases, tag.sort_order, tag.visibility,
             (SELECT count(*)::bigint FROM novel_tags relation WHERE relation.tag_id = tag.id) AS direct_count,
             tag.created_at, tag.updated_at
      FROM tags tag WHERE tag.id = $1`,
    values: [id],
  });
  if (!result.rows[0]) throw new Error("标签不存在");
  return toTag(result.rows[0]);
}

function toTag(row: TagRow): PostgresCatalogTag {
  return {
    id: positiveInteger(row.id, "catalog tag id"),
    parentId: row.parent_id === null ? null : positiveInteger(row.parent_id, "catalog tag parent id"),
    name: row.name,
    slug: row.slug,
    description: row.description,
    aliases: aliases(row.aliases),
    sortOrder: row.sort_order,
    visibility: row.visibility,
    directCount: nonnegativeInteger(row.direct_count, "catalog tag count"),
    createdAt: timestamp(row.created_at, "catalog tag creation timestamp"),
    updatedAt: timestamp(row.updated_at, "catalog tag update timestamp"),
  };
}

function audiencePredicate(audience: PublicTagAudience): string {
  if (audience === "admin") return "TRUE";
  if (audience === "member") return "tag.visibility IN ('public', 'member')";
  if (audience === "public") return "tag.visibility = 'public'";
  throw new Error("Invalid catalog tag audience");
}

export async function listPostgresCatalogTagGroups(
  executor: SqlExecutor,
  options: { audience?: PublicTagAudience; sourceId?: number; omitEmpty?: boolean } = {},
): Promise<PostgresCatalogTagGroup[]> {
  const audience = options.audience ?? "public";
  const visibility = audiencePredicate(audience);
  const values: unknown[] = [];
  const sourceFilter = options.sourceId === undefined
    ? ""
    : (() => {
        values.push(positiveInteger(options.sourceId!, "catalog tag source id"));
        return "WHERE novel.source_id = $1";
      })();
  const result = await executor.query<TagRow>({
    name: options.sourceId === undefined ? `catalog-tag-groups-${audience}-v2` : undefined,
    text: `WITH counts AS (
        SELECT relation.tag_id, count(*)::bigint AS direct_count
        FROM novel_tags relation
        JOIN novels novel ON novel.id = relation.novel_id
        ${sourceFilter}
        GROUP BY relation.tag_id
      )
      SELECT tag.id, tag.parent_id, tag.name, tag.slug, tag.description,
             tag.aliases, tag.sort_order, tag.visibility,
             coalesce(counts.direct_count, 0) AS direct_count,
             tag.created_at, tag.updated_at
      FROM tags tag
      LEFT JOIN counts ON counts.tag_id = tag.id
      WHERE ${visibility}
      ORDER BY tag.sort_order ASC, lower(tag.name) COLLATE "C" ASC, tag.id ASC`,
    values,
  });
  const tags = result.rows.map(toTag);
  const roots = tags.filter((tag) => tag.parentId === null);
  const rootIds = new Set(roots.map((tag) => tag.id));
  const groups: PostgresCatalogTagGroup[] = roots.map((group) => ({
    group,
    tags: tags.filter((tag) => tag.parentId === group.id),
  }));
  const orphaned = tags.filter((tag) => tag.parentId !== null && !rootIds.has(tag.parentId));
  if (orphaned.length) groups.push({ group: null, tags: orphaned });
  if (!options.omitEmpty) return groups;
  return groups.flatMap((group) => {
    const children = group.tags.filter((tag) => tag.directCount > 0);
    return children.length || (group.group?.directCount ?? 0) > 0 ? [{ ...group, tags: children }] : [];
  });
}

export async function getPostgresCatalogTagBySlug(
  executor: SqlExecutor,
  slugValue: string,
  options: { audience?: PublicTagAudience } = {},
): Promise<PostgresCatalogTag | null> {
  const slug = String(slugValue).normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!slug || slug.length > 64 || !POSTGRES_TAG_SLUG_PATTERN.test(slug)) return null;
  const visibility = audiencePredicate(options.audience ?? "public");
  const result = await executor.query<TagRow>({
    text: `SELECT tag.id, tag.parent_id, tag.name, tag.slug, tag.description,
             tag.aliases, tag.sort_order, tag.visibility,
             (SELECT count(*)::bigint FROM novel_tags relation WHERE relation.tag_id = tag.id) AS direct_count,
             tag.created_at, tag.updated_at
      FROM tags tag
      WHERE lower(tag.slug) = $1 AND ${visibility}`,
    values: [slug],
  });
  return result.rows[0] ? toTag(result.rows[0]) : null;
}

export async function createPostgresCatalogTag(
  input: PostgresCatalogTagInput,
  transaction: RunTransaction = withTransaction,
): Promise<PostgresCatalogTag> {
  const name = normalizedTagName(input.name);
  if (!name) throw new Error("标签名称不能为空");
  const parentId = optionalParentId(input.parentId);
  const description = String(input.description || "").normalize("NFKC").trim().slice(0, MAX_TAG_DESCRIPTION_LENGTH);
  const aliasList = normalizedAliases(input.aliases, name);
  const sortOrder = normalizedSortOrder(input.sortOrder);
  const requestedVisibility = normalizedVisibility(input.visibility);
  return transaction(async (executor) => {
    const parent = await resolveTagParent(executor, parentId);
    const visibility = parent && visibilityRank(requestedVisibility) < visibilityRank(parent.visibility)
      ? parent.visibility
      : requestedVisibility;
    const slug = await uniqueTagSlug(executor, input.slug || name);
    const created = await executor.query<QueryResultRow & { id: string | number }>({
      text: `INSERT INTO tags (parent_id, name, slug, description, aliases, sort_order, visibility)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        RETURNING id`,
      values: [parent?.id ?? null, name, slug, description, JSON.stringify(aliasList), sortOrder, visibility],
    });
    if (!created.rows[0]) throw new Error("PostgreSQL 未返回新标签");
    return readAdminTagById(executor, positiveInteger(created.rows[0].id, "created tag id"));
  }, { isolation: "serializable" });
}

export async function updatePostgresCatalogTag(
  input: PostgresCatalogTagInput & { id: number },
  transaction: RunTransaction = withTransaction,
): Promise<boolean> {
  const id = positiveInteger(input.id, "catalog tag id");
  const name = normalizedTagName(input.name);
  if (!name) throw new Error("标签名称不能为空");
  const parentId = optionalParentId(input.parentId, id);
  const description = String(input.description || "").normalize("NFKC").trim().slice(0, MAX_TAG_DESCRIPTION_LENGTH);
  const aliasList = normalizedAliases(input.aliases, name);
  const sortOrder = normalizedSortOrder(input.sortOrder);
  const requestedVisibility = normalizedVisibility(input.visibility);
  return transaction(async (executor) => {
    const current = await executor.query<QueryResultRow & { id: string | number }>({
      text: "SELECT id FROM tags WHERE id = $1 FOR UPDATE",
      values: [id],
    });
    if (!current.rows[0]) return false;
    const parent = await resolveTagParent(executor, parentId, id);
    const visibility = parent && visibilityRank(requestedVisibility) < visibilityRank(parent.visibility)
      ? parent.visibility
      : requestedVisibility;
    const slug = await uniqueTagSlug(executor, input.slug || name, id);
    await executor.query({
      text: `UPDATE tags
        SET parent_id = $2, name = $3, slug = $4, description = $5,
            aliases = $6::jsonb, sort_order = $7, visibility = $8,
            updated_at = clock_timestamp()
        WHERE id = $1`,
      values: [id, parent?.id ?? null, name, slug, description, JSON.stringify(aliasList), sortOrder, visibility],
    });
    await executor.query({
      text: `WITH RECURSIVE descendants(id) AS (
               SELECT id FROM tags WHERE parent_id = $1
               UNION ALL
               SELECT child.id FROM tags child JOIN descendants tree ON child.parent_id = tree.id
             )
             UPDATE tags
             SET visibility = $2, updated_at = clock_timestamp()
             WHERE id IN (SELECT id FROM descendants)
               AND CASE visibility WHEN 'public' THEN 0 WHEN 'member' THEN 1 ELSE 2 END < $3`,
      values: [id, visibility, visibilityRank(visibility)],
    });
    return true;
  }, { isolation: "serializable" });
}

export async function deletePostgresCatalogTag(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM tags WHERE id = $1",
    values: [positiveInteger(idValue, "catalog tag id")],
  });
  return (result.rowCount ?? 0) > 0;
}

export function parsePostgresNovelHotwords(value: string): string[] {
  if (!String(value).isWellFormed() || String(value).includes("\0")) throw new Error("热词格式无效");
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const rawTerm of String(value).split(/[\n,，、]+/u)) {
    const term = rawTerm.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!term || seen.has(term)) continue;
    if (Array.from(term).length > MAX_HOTWORD_CHARACTERS) throw new Error("热词不能超过 15 字");
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_HOTWORD_COUNT) break;
  }
  return terms;
}

export async function replacePostgresNovelTagsAndHotwords(
  novelIdValue: number,
  tagIds: readonly number[],
  hotwords: readonly string[],
  transaction: RunTransaction = withTransaction,
): Promise<boolean> {
  const novelId = positiveInteger(novelIdValue, "tagged novel id");
  if (!Array.isArray(tagIds) || tagIds.length > 1_000) throw new Error("标签选择无效");
  const requestedTagIds = [...new Set(tagIds.map((id) => positiveInteger(id, "selected tag id")))];
  const terms = parsePostgresNovelHotwords(hotwords.join("\n"));
  return transaction(async (executor) => {
    const novel = await executor.query<QueryResultRow & { id: number }>({
      text: "SELECT id FROM novels WHERE id = $1 FOR UPDATE",
      values: [novelId],
    });
    if (!novel.rows[0]) return false;
    await executor.query({ text: "DELETE FROM novel_tags WHERE novel_id = $1", values: [novelId] });
    if (requestedTagIds.length) {
      await executor.query({
        text: `INSERT INTO novel_tags (novel_id, tag_id)
          SELECT $1, selected.id
          FROM unnest($2::bigint[]) WITH ORDINALITY AS selected(id, ordinal)
          JOIN tags tag ON tag.id = selected.id
          ORDER BY selected.ordinal`,
        values: [novelId, requestedTagIds],
      });
    }
    await executor.query({ text: "DELETE FROM novel_hotwords WHERE novel_id = $1", values: [novelId] });
    if (terms.length) {
      await executor.query({
        text: `INSERT INTO novel_hotwords (novel_id, term, sort_order)
          SELECT $1, item.term, item.ordinal - 1
          FROM unnest($2::text[]) WITH ORDINALITY AS item(term, ordinal)
          ORDER BY item.ordinal`,
        values: [novelId, terms],
      });
    }
    return true;
  }, { isolation: "repeatable read" });
}

export async function addPostgresNovelTagsAndHotwords(
  novelIdValue: number,
  tagIds: readonly number[],
  hotwords: readonly string[],
  transaction: RunTransaction = withTransaction,
): Promise<boolean> {
  const novelId = positiveInteger(novelIdValue, "tagged novel id");
  if (!Array.isArray(tagIds) || tagIds.length > 1_000) throw new Error("标签选择无效");
  const requestedTagIds = [...new Set(tagIds.map((id) => positiveInteger(id, "selected tag id")))];
  const terms = parsePostgresNovelHotwords(hotwords.join("\n"));
  return transaction(async (executor) => {
    const novel = await executor.query<QueryResultRow & { id: number }>({
      text: "SELECT id FROM novels WHERE id = $1 FOR UPDATE",
      values: [novelId],
    });
    if (!novel.rows[0]) return false;
    if (requestedTagIds.length) {
      await executor.query({
        text: `INSERT INTO novel_tags (novel_id, tag_id)
          SELECT $1, selected.id
          FROM unnest($2::bigint[]) WITH ORDINALITY AS selected(id, ordinal)
          JOIN tags tag ON tag.id = selected.id
          ORDER BY selected.ordinal
          ON CONFLICT (novel_id, tag_id) DO NOTHING`,
        values: [novelId, requestedTagIds],
      });
    }
    if (terms.length) {
      await executor.query({
        text: `WITH input AS (
                 SELECT term, ordinal
                 FROM unnest($2::text[]) WITH ORDINALITY AS item(term, ordinal)
               ), base AS (
                 SELECT coalesce(max(sort_order), -1) AS last_order, count(*) AS existing_count
                 FROM novel_hotwords WHERE novel_id = $1
               ), additions AS (
                 SELECT input.term, input.ordinal FROM input
                 WHERE NOT EXISTS (
                   SELECT 1 FROM novel_hotwords existing WHERE existing.novel_id = $1 AND existing.term = input.term
                 )
                 ORDER BY input.ordinal
                 LIMIT (SELECT greatest(0, 24 - existing_count) FROM base)
               )
               INSERT INTO novel_hotwords (novel_id, term, sort_order)
               SELECT $1, additions.term, base.last_order + additions.ordinal
               FROM additions CROSS JOIN base
               ORDER BY additions.ordinal
               ON CONFLICT (novel_id, term) DO NOTHING`,
        values: [novelId, terms],
      });
    }
    return true;
  }, { isolation: "repeatable read" });
}

export async function listPostgresExplicitlyHiddenTagIds(
  executor: SqlExecutor,
  userIdValue: number,
): Promise<Set<number>> {
  const result = await executor.query<QueryResultRow & { tag_id: string | number }>({
    name: "catalog-explicit-hidden-tags-v1",
    text: "SELECT tag_id FROM user_hidden_tags WHERE user_id = $1 ORDER BY tag_id",
    values: [positiveInteger(userIdValue, "tag preference user id")],
  });
  return new Set(result.rows.map((row) => positiveInteger(row.tag_id, "hidden tag id")));
}

type RunTransaction = typeof withTransaction;

export async function replacePostgresUserHiddenTags(
  userIdValue: number,
  tagIds: readonly number[],
  transaction: RunTransaction = withTransaction,
): Promise<number[]> {
  const userId = positiveInteger(userIdValue, "tag preference user id");
  if (!Array.isArray(tagIds) || tagIds.length > 1_000) throw new Error("Invalid hidden tag selection");
  const requested = [...new Set(tagIds.map((id) => positiveInteger(id, "hidden tag id")))].sort((a, b) => a - b);
  return transaction(async (executor) => {
    const validResult = requested.length
      ? await executor.query<QueryResultRow & { id: string | number }>({
          text: "SELECT id FROM tags WHERE id = ANY($1::bigint[]) ORDER BY id FOR SHARE",
          values: [requested],
        })
      : { rows: [] };
    const valid = validResult.rows.map((row) => positiveInteger(row.id, "stored hidden tag id"));
    await executor.query({ text: "DELETE FROM user_hidden_tags WHERE user_id = $1", values: [userId] });
    if (valid.length) {
      await executor.query({
        text: `INSERT INTO user_hidden_tags (user_id, tag_id)
          SELECT $1, selected.id FROM unnest($2::bigint[]) WITH ORDINALITY AS selected(id, ordinal)
          ORDER BY selected.ordinal`,
        values: [userId, valid],
      });
    }
    return valid;
  }, { isolation: "repeatable read" });
}
