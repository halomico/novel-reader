import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";

export const POSTGRES_USER_PERMISSION_DEFINITIONS = [
  { key: "advanced_search", label: "高级搜索" },
  { key: "market_access", label: "访问集市" },
  { key: "video_download", label: "视频下载" },
] as const;

export const POSTGRES_BASE_USER_PERMISSION_DEFINITIONS = [
  { key: "content_report", label: "内容反馈" },
  { key: "station_message", label: "站务留言" },
  { key: "novel_feedback", label: "推荐" },
] as const;

export type PostgresUserPermission =
  | (typeof POSTGRES_USER_PERMISSION_DEFINITIONS)[number]["key"]
  | (typeof POSTGRES_BASE_USER_PERMISSION_DEFINITIONS)[number]["key"];

export type PostgresUserLevelDefinition = Readonly<{
  level: number;
  name: string;
  sodaRequired: number;
  dailyVideoDownloadLimit: number;
  permissions: PostgresUserPermission[];
  updatedAt: string;
}>;

type PermissionRow = QueryResultRow & { allowed: boolean };
type LevelRow = QueryResultRow & {
  level: number;
  name: string;
  soda_required: string | number;
  daily_video_download_limit: number;
  permissions: unknown;
  updated_at: Date | string;
};

const BASE_PERMISSIONS = new Set<PostgresUserPermission>(POSTGRES_BASE_USER_PERMISSION_DEFINITIONS.map((item) => item.key));
const CONFIGURABLE_PERMISSIONS = new Set<PostgresUserPermission>(POSTGRES_USER_PERMISSION_DEFINITIONS.map((item) => item.key));

function validTrustLevel(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
    throw new Error("Invalid PostgreSQL user trust level");
  }
  return value;
}

function count(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL user-level timestamp");
  return parsed.toISOString();
}

function permissions(value: unknown): PostgresUserPermission[] {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return []; } })() : value;
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((item): item is PostgresUserPermission => typeof item === "string" && CONFIGURABLE_PERMISSIONS.has(item as PostgresUserPermission)))];
}

function level(row: LevelRow): PostgresUserLevelDefinition {
  return {
    level: validTrustLevel(row.level),
    name: row.name,
    sodaRequired: count(row.soda_required, "user-level soda requirement"),
    dailyVideoDownloadLimit: Math.min(count(row.daily_video_download_limit, "daily video download limit"), 1_000),
    permissions: permissions(row.permissions),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function listPostgresUserLevelDefinitions(executor: SqlExecutor): Promise<PostgresUserLevelDefinition[]> {
  const result = await executor.query<LevelRow>({
    name: "identity-list-user-levels-v1",
    text: `SELECT level, name, soda_required,
      daily_video_download_limit, permissions, updated_at
      FROM user_levels ORDER BY level ASC`,
  });
  return result.rows.map(level);
}

export async function getPostgresUserLevelDefinition(executor: SqlExecutor, levelValue: number): Promise<PostgresUserLevelDefinition> {
  const normalized = validTrustLevel(Math.min(Math.max(Math.floor(Number(levelValue) || 0), 0), 6));
  const result = await executor.query<LevelRow>({
    name: "identity-get-user-level-v1",
    text: `SELECT level, name, soda_required,
      daily_video_download_limit, permissions, updated_at FROM user_levels WHERE level = $1`,
    values: [normalized],
  });
  return result.rows[0] ? level(result.rows[0]) : {
    level: normalized,
    name: `等级 ${normalized}`,
    sodaRequired: 0,
    dailyVideoDownloadLimit: normalized === 0 ? 0 : 3,
    permissions: [],
    updatedAt: "",
  };
}

export async function savePostgresUserLevelDefinition(executor: SqlExecutor, input: {
  level: number;
  name: string;
  sodaRequired: number;
  dailyVideoDownloadLimit?: number;
  permissions: readonly string[];
}): Promise<boolean> {
  const normalizedLevel = validTrustLevel(Math.min(Math.max(Math.floor(Number(input.level) || 0), 0), 6));
  const name = Array.from(input.name.normalize("NFKC").replace(/\s+/gu, " ").trim()).slice(0, 20).join("");
  if (!name) return false;
  const selected = [...new Set(input.permissions.filter((item): item is PostgresUserPermission => CONFIGURABLE_PERMISSIONS.has(item as PostgresUserPermission)))];
  const sodaRequired = normalizedLevel < 2 ? 0 : Math.min(Math.max(Math.floor(Number(input.sodaRequired) || 0), 1), 2_000_000_000);
  const downloads = normalizedLevel === 0 ? 0 : input.dailyVideoDownloadLimit == null ? null : Math.min(Math.max(Math.floor(Number(input.dailyVideoDownloadLimit) || 0), 0), 1_000);
  const result = await executor.query({
    text: `UPDATE user_levels SET name = $2, soda_required = $3,
      daily_video_download_limit = COALESCE($4::integer, daily_video_download_limit),
      permissions = $5::jsonb, updated_at = clock_timestamp() WHERE level = $1`,
    values: [normalizedLevel, name, sodaRequired, downloads, JSON.stringify(selected)],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function recalculatePostgresUserLevels(executor: SqlExecutor): Promise<number> {
  const result = await executor.query({
    text: `WITH calculated AS (
        SELECT account.id, COALESCE(MAX(definition.level), 1)::integer AS level
        FROM users account
        LEFT JOIN user_levels definition
          ON definition.level >= 1 AND definition.soda_required <= account.soda_experience
        WHERE account.deleted_at IS NULL
        GROUP BY account.id
      )
      UPDATE users account
      SET trust_level = calculated.level, updated_at = clock_timestamp()
      FROM calculated
      WHERE account.id = calculated.id
        AND account.trust_level IS DISTINCT FROM calculated.level`,
  });
  return result.rowCount ?? 0;
}

export async function getPostgresUserGrowthProgress(executor: SqlExecutor, sodaExperienceValue: number) {
  const sodaExperience = Number.isSafeInteger(sodaExperienceValue) && sodaExperienceValue > 0 ? sodaExperienceValue : 0;
  const levels = await listPostgresUserLevelDefinitions(executor);
  const current = [...levels].reverse().find((item) => item.level >= 1 && item.sodaRequired <= sodaExperience)
    ?? levels.find((item) => item.level === 1)
    ?? await getPostgresUserLevelDefinition(executor, 1);
  const next = levels.find((item) => item.level === current.level + 1) ?? null;
  if (!next) return { current, next: null, progress: 100, currentValue: sodaExperience, targetValue: current.sodaRequired };
  const span = Math.max(next.sodaRequired - current.sodaRequired, 1);
  return {
    current,
    next,
    progress: Math.min(Math.max(((sodaExperience - current.sodaRequired) / span) * 100, 0), 100),
    currentValue: sodaExperience,
    targetValue: next.sodaRequired,
  };
}

/** Reads shared role permissions from the normalized PostgreSQL identity model. */
export async function hasPostgresUserPermission(
  executor: SqlExecutor,
  user: { role: "admin" | "user"; trustLevel: number } | null | undefined,
  permission: PostgresUserPermission,
): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (!CONFIGURABLE_PERMISSIONS.has(permission)) return BASE_PERMISSIONS.has(permission);
  const result = await executor.query<PermissionRow>({
    name: "identity-check-user-level-permission-v1",
    text: `SELECT EXISTS (
             SELECT 1 FROM user_levels
             WHERE level = $1 AND permissions ? $2
           ) AS allowed`,
    values: [validTrustLevel(user.trustLevel), permission],
  });
  return result.rows[0]?.allowed === true;
}
