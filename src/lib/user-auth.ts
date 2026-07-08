import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { getClientIp } from "./admin-access";
import { getDb } from "./db";
import { getUserPasswordRow, recordUserLogin, type UserProfile } from "./users";

export const USER_SESSION_COOKIE = "novel_user_session";

const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionUserRow = {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string | null;
  status: string;
  search_rate_limit_per_minute: number | null;
  registration_ip: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_login_ip: string | null;
};

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

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
    registrationIp: row.registration_ip,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
  };
}

function parseSessionValue(value: string): { id: string; token: string } | null {
  const [id, token] = value.split(".");
  if (!id || !token) {
    return null;
  }
  return { id, token };
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
              u.registration_ip, u.created_at, u.updated_at, u.last_login_at, u.last_login_ip
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
    )
    .get(parsed.id, hashSessionToken(parsed.token), Date.now()) as SessionUserRow | undefined;

  return row ? toUserProfile(row) : null;
}

export function hashUserPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha256").toString("base64url");
  return `pbkdf2-sha256:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

export function verifyUserPassword(password: string, storedHash: string): boolean {
  const [scheme, iterationsText, salt, expectedHash] = storedHash.split(":");
  const iterations = Number(iterationsText);
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 10_000 || !salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto.pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, "sha256").toString("base64url");
  return timingSafeEqualText(actualHash, expectedHash);
}

export async function createUserSession(userId: number, ip: string, userAgent: string) {
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
  cookieStore.set(USER_SESSION_COOKIE, `${sessionId}.${token}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function loginUser(username: string, password: string): Promise<{ ok: true; user: UserProfile } | { ok: false; message: string }> {
  const row = getUserPasswordRow(username);
  if (!row || row.status === "disabled" || !verifyUserPassword(password, row.password_hash)) {
    return { ok: false, message: "用户名或密码不正确" };
  }

  const headerStore = await headers();
  const ip = getClientIp(headerStore);
  const userAgent = headerStore.get("user-agent") || "";
  recordUserLogin(row.id, ip, userAgent);
  await createUserSession(row.id, ip, userAgent);
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

export function deleteExpiredUserSessions() {
  getDb().prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(Date.now());
}
