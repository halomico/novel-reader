import { getDb } from "./db";

export const USER_PERMISSION_DEFINITIONS = [
  { key: "advanced_search", label: "高级搜索" },
  { key: "market_access", label: "访问集市" },
  { key: "market_purchase", label: "购买商品" },
  { key: "video_download", label: "显示视频下载" },
] as const;

export const BASE_USER_PERMISSION_DEFINITIONS = [
  { key: "content_report", label: "内容反馈" },
  { key: "station_message", label: "站务留言" },
  { key: "novel_feedback", label: "推荐" },
] as const;

export type UserPermission =
  | (typeof USER_PERMISSION_DEFINITIONS)[number]["key"]
  | (typeof BASE_USER_PERMISSION_DEFINITIONS)[number]["key"];

export type UserLevelDefinition = {
  level: number;
  name: string;
  sodaRequired: number;
  videoConcurrencyLimit: number;
  dailyVideoDownloadLimit: number;
  permissions: UserPermission[];
  updatedAt: string;
};

type UserLevelRow = {
  level: number;
  name: string;
  soda_required: number;
  video_concurrency_limit: number;
  daily_video_download_limit: number;
  permissions: string;
  updated_at: string;
};

const BASE_PERMISSIONS = new Set<UserPermission>(BASE_USER_PERMISSION_DEFINITIONS.map((item) => item.key));
const CONFIGURABLE_PERMISSIONS = new Set<UserPermission>(USER_PERMISSION_DEFINITIONS.map((item) => item.key));

function normalizeLevel(value: number): number {
  return Math.min(Math.max(Math.floor(Number(value) || 0), 0), 6);
}

function parsePermissions(value: string): UserPermission[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is UserPermission => typeof item === "string" && CONFIGURABLE_PERMISSIONS.has(item as UserPermission));
  } catch {
    return [];
  }
}

function toLevelDefinition(row: UserLevelRow): UserLevelDefinition {
  return {
    level: row.level,
    name: row.name,
    sodaRequired: Math.max(Math.floor(row.soda_required || 0), 0),
    videoConcurrencyLimit: Math.min(Math.max(Math.floor(row.video_concurrency_limit || 0), 0), 20),
    dailyVideoDownloadLimit: Math.min(Math.max(Math.floor(row.daily_video_download_limit || 0), 0), 1_000),
    permissions: parsePermissions(row.permissions),
    updatedAt: row.updated_at,
  };
}

export function listUserLevelDefinitions(): UserLevelDefinition[] {
  return (getDb()
    .prepare(
      "SELECT level, name, soda_required, video_concurrency_limit, daily_video_download_limit, permissions, updated_at FROM user_levels ORDER BY level ASC",
    )
    .all() as UserLevelRow[]).map(toLevelDefinition);
}

export function getUserLevelDefinition(level: number): UserLevelDefinition {
  const normalized = normalizeLevel(level);
  const row = getDb()
    .prepare(
      "SELECT level, name, soda_required, video_concurrency_limit, daily_video_download_limit, permissions, updated_at FROM user_levels WHERE level = ?",
    )
    .get(normalized) as UserLevelRow | undefined;
  return row
    ? toLevelDefinition(row)
    : {
        level: normalized,
        name: `等级 ${normalized}`,
        sodaRequired: 0,
        videoConcurrencyLimit: normalized === 0 ? 0 : 1,
        dailyVideoDownloadLimit: normalized === 0 ? 0 : 3,
        permissions: [],
        updatedAt: "",
      };
}

export function saveUserLevelDefinition(input: {
  level: number;
  name: string;
  sodaRequired: number;
  videoConcurrencyLimit?: number;
  dailyVideoDownloadLimit?: number;
  permissions: readonly string[];
}): boolean {
  const level = normalizeLevel(input.level);
  const name = input.name.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 20);
  if (!name) {
    return false;
  }
  const permissions = [...new Set(
    input.permissions.filter((item): item is UserPermission => CONFIGURABLE_PERMISSIONS.has(item as UserPermission)),
  )];
  const sodaRequired = level < 2
    ? 0
    : Math.min(Math.max(Math.floor(Number(input.sodaRequired) || 0), 1), 2_000_000_000);
  const videoConcurrencyLimit = level === 0
    ? 0
    : input.videoConcurrencyLimit == null
      ? getUserLevelDefinition(level).videoConcurrencyLimit
      : Math.min(Math.max(Math.floor(Number(input.videoConcurrencyLimit) || 0), 0), 20);
  const dailyVideoDownloadLimit = level === 0
    ? 0
    : input.dailyVideoDownloadLimit == null
      ? getUserLevelDefinition(level).dailyVideoDownloadLimit
      : Math.min(Math.max(Math.floor(Number(input.dailyVideoDownloadLimit) || 0), 0), 1_000);
  return getDb()
    .prepare(
      `UPDATE user_levels
       SET name = ?, soda_required = ?, video_concurrency_limit = ?, daily_video_download_limit = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP
       WHERE level = ?`,
    )
    .run(name, sodaRequired, videoConcurrencyLimit, dailyVideoDownloadLimit, JSON.stringify(permissions), level).changes > 0;
}

export function getUserLevelForExperience(sodaExperience: number): number {
  const experience = Math.max(Math.floor(Number(sodaExperience) || 0), 0);
  const row = getDb()
    .prepare(
      `SELECT level
       FROM user_levels
       WHERE level >= 1 AND soda_required <= ?
       ORDER BY level DESC
       LIMIT 1`,
    )
    .get(experience) as { level: number } | undefined;
  return Math.min(Math.max(row?.level || 1, 1), 6);
}

export function recalculateUserLevels() {
  const levels = listUserLevelDefinitions().filter((level) => level.level >= 1);
  const db = getDb();
  const update = db.prepare("UPDATE users SET trust_level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  const users = db.prepare("SELECT id, soda_experience FROM users").all() as Array<{ id: number; soda_experience: number }>;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const user of users) {
      const level = [...levels].reverse().find((item) => item.sodaRequired <= user.soda_experience)?.level || 1;
      update.run(level, user.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getUserGrowthProgress(sodaExperience: number): {
  current: UserLevelDefinition;
  next: UserLevelDefinition | null;
  progress: number;
  currentValue: number;
  targetValue: number;
} {
  const experience = Math.max(Math.floor(Number(sodaExperience) || 0), 0);
  const levels = listUserLevelDefinitions();
  const currentLevel = getUserLevelForExperience(experience);
  const current = levels.find((level) => level.level === currentLevel) || getUserLevelDefinition(currentLevel);
  const next = levels.find((level) => level.level === currentLevel + 1) || null;
  if (!next) {
    return {
      current,
      next: null,
      progress: 100,
      currentValue: experience,
      targetValue: current.sodaRequired,
    };
  }
  const span = Math.max(next.sodaRequired - current.sodaRequired, 1);
  return {
    current,
    next,
    progress: Math.min(Math.max(((experience - current.sodaRequired) / span) * 100, 0), 100),
    currentValue: experience,
    targetValue: next.sodaRequired,
  };
}

export function hasUserPermission(
  user: { role: "user" | "admin"; trustLevel: number } | null | undefined,
  permission: UserPermission,
): boolean {
  if (!user) {
    return false;
  }
  if (user.role === "admin") {
    return true;
  }
  if (BASE_PERMISSIONS.has(permission)) {
    return true;
  }
  return getUserLevelDefinition(user.trustLevel).permissions.includes(permission);
}
