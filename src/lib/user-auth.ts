import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  PostgresIdentityRepository,
  USER_SESSION_COOKIE,
  USER_SESSION_TTL_SECONDS,
  type SessionPrincipal,
} from "@/domains/identity/postgres-identity";
import { getTrustedClientIp } from "@/core/security/client-ip";
import { generatedAvatarPath } from "./default-avatar-data";
import { LOCALE_COOKIE } from "./locale";
import {
  hashPasswordAsync,
  passwordNeedsRehash,
  PasswordVerificationUnavailableError,
  verifyPasswordAsync,
} from "./password";
import type { PostgresUserProfile as UserProfile } from "@/domains/identity/postgres-users";

export { USER_SESSION_COOKIE };

const identity = new PostgresIdentityRepository();

function toUserProfile(principal: SessionPrincipal): UserProfile {
  return {
    id: principal.id,
    username: principal.username,
    displayName: principal.displayName,
    email: principal.email,
    emailVerifiedAt: principal.emailVerifiedAt,
    avatarPath: principal.avatarPath,
    status: principal.status,
    role: principal.role,
    trustLevel: principal.trustLevel,
    sodaBalance: principal.sodaBalance,
    sodaExperience: principal.sodaExperience,
    cookieBalance: principal.cookieBalance,
    localePreference: principal.localePreference,
    readingHistoryEnabled: principal.readingHistoryEnabled,
    originalReadingHistoryEnabled: principal.originalReadingHistoryEnabled,
    registrationIp: null,
    createdAt: principal.createdAt,
    updatedAt: principal.updatedAt,
    lastLoginAt: principal.lastLoginAt,
    lastLoginIp: null,
  };
}

export async function hashUserPassword(password: string): Promise<string> {
  return hashPasswordAsync(password);
}

export async function verifyUserPassword(password: string, storedHash?: string | null): Promise<boolean> {
  return verifyPasswordAsync(password, storedHash);
}

export async function createUserSession(userId: number, ip: string, userAgent: string, persistent = true): Promise<void> {
  const credential = await identity.createSession(userId, { ip, userAgent });
  if (!credential) throw new Error("Cannot create a session for an inactive user");
  const cookieStore = await cookies();
  cookieStore.set(USER_SESSION_COOKIE, credential.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(persistent ? { maxAge: credential.maxAgeSeconds } : {}),
  });
}

export async function loginUser(
  username: string,
  password: string,
  persistent = true,
): Promise<{ ok: true; user: UserProfile } | { ok: false; message: string }> {
  const loginUser = await identity.findLoginUser(username);
  let passwordValid = false;
  try {
    passwordValid = await verifyUserPassword(password, loginUser?.passwordHash);
  } catch (error) {
    if (error instanceof PasswordVerificationUnavailableError) {
      return { ok: false, message: "登录服务繁忙，请稍后再试" };
    }
    throw error;
  }
  if (!loginUser || loginUser.status === "disabled" || !passwordValid) {
    return { ok: false, message: "用户名或密码不正确" };
  }
  if (loginUser.status === "pending") {
    return { ok: false, message: "邮箱尚未验证，请先完成验证" };
  }

  const headerStore = await headers();
  const ip = getTrustedClientIp(headerStore);
  const userAgent = headerStore.get("user-agent") || "";
  const principal = await identity.completeSuccessfulLogin(loginUser.id, {
    ip,
    userAgent,
    defaultAvatarPath: generatedAvatarPath(crypto.randomBytes(8).toString("hex")),
    passwordHash: passwordNeedsRehash(loginUser.passwordHash) ? await hashUserPassword(password) : null,
  });
  if (!principal) return { ok: false, message: "用户名或密码不正确" };
  await createUserSession(principal.id, ip, userAgent, persistent);
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, principal.localePreference, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: USER_SESSION_TTL_SECONDS,
  });
  return { ok: true, user: toUserProfile(principal) };
}

async function readCurrentUser(): Promise<UserProfile | null> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const principal = await identity.resolveSession(cookieStore.get(USER_SESSION_COOKIE)?.value, {
    ip: getTrustedClientIp(headerStore),
    userAgent: headerStore.get("user-agent"),
  });
  return principal ? toUserProfile(principal) : null;
}

export const getCurrentUser = cache(readCurrentUser);

export async function getCurrentUserFromRequest(request: NextRequest): Promise<UserProfile | null> {
  const principal = await identity.resolveSession(request.cookies.get(USER_SESSION_COOKIE)?.value, {
    ip: getTrustedClientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
  });
  return principal ? toUserProfile(principal) : null;
}

export async function clearCurrentUserSession(): Promise<void> {
  const cookieStore = await cookies();
  await identity.revokeSession(cookieStore.get(USER_SESSION_COOKIE)?.value);
  cookieStore.set(USER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function deleteUserSessions(userId: number): Promise<number> {
  return identity.revokeAllUserSessions(userId);
}
