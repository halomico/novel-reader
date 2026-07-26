import { getDb } from "./db";

export const USER_PERMISSION_DEFINITIONS = [
  { key: "content_report", label: "内容举报" },
  { key: "station_message", label: "站务留言" },
  { key: "novel_feedback", label: "推荐" },
  { key: "advanced_search", label: "高级搜索" },
] as const;

export type UserPermission = (typeof USER_PERMISSION_DEFINITIONS)[number]["key"];

export type UserLevelDefinition = {
  level: number;
  name: string;
  sodaRequired: number;
  permissions: UserPermission[];
  updatedAt: string;
};

type UserLevelRow = {
  level: number;
  name: string;
  soda_required: number;
  permissions: string;
  updated_at: string;
};

const PERMISSIONS = new Set<UserPermission>(USER_PERMISSION_DEFINITIONS.map((item) => item.key));

function normalizeLevel(value: number): number {
  return Math.min(Math.max(Math.floor(Number(value) || 0), 0), 6);
}

function parsePermissions(value: string): UserPermission[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is UserPermission => typeof item === "string" && PERMISSIONS.has(item as UserPermission));
  } catch {
    return [];
  }
}

function toLevelDefinition(row: UserLevelRow): UserLevelDefinition {
  return {
    level: row.level,
    name: row.name,
    sodaRequired: Math.max(Math.floor(row.soda_required || 0), 0),
    permissions: parsePermissions(row.permissions),
    updatedAt: row.updated_at,
  };
}

export function listUserLevelDefinitions(): UserLevelDefinition[] {
  return (getDb()
    .prepare("SELECT level, name, soda_required, permissions, updated_at FROM user_levels ORDER BY level ASC")
    .all() as UserLevelRow[]).map(toLevelDefinition);
}

export function getUserLevelDefinition(level: number): UserLevelDefinition {
  const normalized = normalizeLevel(level);
  const row = getDb()
    .prepare("SELECT level, name, soda_required, permissions, updated_at FROM user_levels WHERE level = ?")
    .get(normalized) as UserLevelRow | undefined;
  return row
    ? toLevelDefinition(row)
    : { level: normalized, name: `等级 ${normalized}`, sodaRequired: 0, permissions: [], updatedAt: "" };
}

export function saveUserLevelDefinition(input: {
  level: number;
  name: string;
  sodaRequired: number;
  permissions: readonly string[];
}): boolean {
  const level = normalizeLevel(input.level);
  const name = input.name.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 20);
  if (!name) {
    return false;
  }
  const permissions = [...new Set(
    input.permissions.filter((item): item is UserPermission => PERMISSIONS.has(item as UserPermission)),
  )];
  const sodaRequired = level < 2
    ? 0
    : Math.min(Math.max(Math.floor(Number(input.sodaRequired) || 0), 1), 2_000_000_000);
  return getDb()
    .prepare(
      `UPDATE user_levels
       SET name = ?, soda_required = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP
       WHERE level = ?`,
    )
    .run(name, sodaRequired, JSON.stringify(permissions), level).changes > 0;
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
  return getUserLevelDefinition(user.trustLevel).permissions.includes(permission);
}
