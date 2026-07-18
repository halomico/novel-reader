import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { getClientIp } from "./admin-access";
import { getDb } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { getUserPasswordRow, recordUserLogin, type UserProfile } from "./users";

export const USER_SESSION_COOKIE = "novel_user_session";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionUserRow = {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string | null;
  status: string;
  search_rate_limit_per_minute: number | null;
  history_visible: number;
  registration_ip: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_login_ip: string | null;
};

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toUserProfile(row: SessionUserRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    status: row.status === "disabled" ? "disabled" : "active",
    searchRateLimitPerMinute: row.search_rate_limit_per_minute,
    historyVisible: row.history_visible === 1,
    registrationIp: row.registration_ip,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
  };
}

function parseSessionValue(value: string): { id: string; token: string } | null {
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { id: parts[0], token: parts[1] };
}

function readUserFromSessionValue(value: string | undefined): UserProfile | null {
  if (!value) {
    return null;
  }

  const parsed = parseSessionValue(value);
  if (!parsed) {
    return null;
  }

  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_path, u.status, u.search_rate_limit_per_minute,
              u.history_visible, u.registration_ip, u.created_at, u.updated_at, u.last_login_at, u.last_login_ip
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
    )
    .get(parsed.id, hashSessionToken(parsed.token), Date.now()) as SessionUserRow | undefined;

  return row ? toUserProfile(row) : null;
}

export function hashUserPassword(password: string): string {
  return hashPassword(password);
}

export function verifyUserPassword(password: string, storedHash: string): boolean {
  return verifyPassword(password, storedHash);
}

export async function createUserSession(userId: number, ip: string, userAgent: string, persistent = true) {
  deleteExpiredUserSessions();
  const sessionId = crypto.randomBytes(18).toString("base64url");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

  getDb()
    .prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_seen_at, last_ip, user_agent)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
    )
    .run(sessionId, userId, hashSessionToken(token), expiresAt, ip, userAgent.slice(0, 240));

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(persistent ? { maxAge: SESSION_TTL_SECONDS } : {}),
  };
  cookieStore.set(USER_SESSION_COOKIE, `${sessionId}.${token}`, cookieOptions);
}

export async function loginUser(
  username: string,
  password: string,
  persistent = true,
): Promise<{ ok: true; user: UserProfile } | { ok: false; message: string }> {
  const row = getUserPasswordRow(username);
  if (!row || row.status === "disabled" || !verifyUserPassword(password, row.password_hash)) {
    return { ok: false, message: "用户名或密码不正确" };
  }

  const headerStore = await headers();
  const ip = getClientIp(headerStore);
  const userAgent = headerStore.get("user-agent") || "";
  recordUserLogin(row.id, ip, userAgent);
  await createUserSession(row.id, ip, userAgent, persistent);
  return { ok: true, user: toUserProfile({ ...row, last_login_at: new Date().toISOString(), last_login_ip: ip }) };
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  const cookieStore = await cookies();
  return readUserFromSessionValue(cookieStore.get(USER_SESSION_COOKIE)?.value);
}

export function getCurrentUserFromRequest(request: NextRequest): UserProfile | null {
  return readUserFromSessionValue(request.cookies.get(USER_SESSION_COOKIE)?.value);
}

export async function clearCurrentUserSession() {
  const cookieStore = await cookies();
  const parsed = parseSessionValue(cookieStore.get(USER_SESSION_COOKIE)?.value || "");
  if (parsed) {
    getDb().prepare("DELETE FROM user_sessions WHERE id = ?").run(parsed.id);
  }
  cookieStore.set(USER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function deleteUserSessions(userId: number) {
  getDb().prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
}

export function deleteExpiredUserSessions() {
  getDb().prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(Date.now());
}
