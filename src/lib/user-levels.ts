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
  permissions: UserPermission[];
  updatedAt: string;
};

type UserLevelRow = {
  level: number;
  name: string;
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
    permissions: parsePermissions(row.permissions),
    updatedAt: row.updated_at,
  };
}

export function listUserLevelDefinitions(): UserLevelDefinition[] {
  return (getDb()
    .prepare("SELECT level, name, permissions, updated_at FROM user_levels ORDER BY level ASC")
    .all() as UserLevelRow[]).map(toLevelDefinition);
}

export function getUserLevelDefinition(level: number): UserLevelDefinition {
  const normalized = normalizeLevel(level);
  const row = getDb()
    .prepare("SELECT level, name, permissions, updated_at FROM user_levels WHERE level = ?")
    .get(normalized) as UserLevelRow | undefined;
  return row
    ? toLevelDefinition(row)
    : { level: normalized, name: `等级 ${normalized}`, permissions: [], updatedAt: "" };
}

export function saveUserLevelDefinition(input: {
  level: number;
  name: string;
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
  return getDb()
    .prepare(
      `UPDATE user_levels
       SET name = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP
       WHERE level = ?`,
    )
    .run(name, JSON.stringify(permissions), level).changes > 0;
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
