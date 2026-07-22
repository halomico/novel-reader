import crypto from "node:crypto";
import { cookies } from "next/headers";
import {
  getAdminCookieName,
  getAdminPassword,
  getAdminPasswordHash,
  getAdminPasswordSha256,
  getAdminSessionSecret,
  getAdminSessionTtlHours,
  getAdminUsername,
} from "./config";
import { verifyPassword } from "./password";
import type { UserProfile } from "./users";

export type AdminSession = {
  username: string;
  expiresAt: number;
};

function getAdminSiteCookieName(): string {
  return `${getAdminCookieName()}_site`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(username: string, expiresAt: number): string {
  const credentialFingerprint = getAdminPasswordHash() || getAdminPasswordSha256() || sha256(getAdminPassword());
  return crypto
    .createHmac("sha256", getAdminSessionSecret())
    .update(`${username}.${expiresAt}.${credentialFingerprint}`)
    .digest("hex");
}

function createSessionToken(username: string, expiresAt: number): string {
  const signature = signSession(username, expiresAt);
  return `${Buffer.from(username, "utf8").toString("base64url")}.${expiresAt}.${signature}`;
}

function parseSessionToken(token: string): AdminSession | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [encodedUsername, expiresText, signature] = parts;
  if (!encodedUsername || !/^[a-zA-Z0-9_-]+$/.test(encodedUsername)) {
    return null;
  }
  const username = Buffer.from(encodedUsername, "base64url").toString("utf8");
  const expiresAt = Number(expiresText);

  if (
    !username ||
    Buffer.from(username, "utf8").toString("base64url") !== encodedUsername ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    !signature ||
    !safeEqual(username, getAdminUsername())
  ) {
    return null;
  }

  if (!safeEqual(signature, signSession(username, expiresAt))) {
    return null;
  }

  return { username, expiresAt };
}

export function isAdminSecurityConfigured(): boolean {
  return Boolean(getAdminSessionSecret() && (getAdminPassword() || getAdminPasswordHash() || getAdminPasswordSha256()));
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  if (!isAdminSecurityConfigured() || !safeEqual(username, getAdminUsername())) {
    return false;
  }

  const strongPasswordHash = getAdminPasswordHash();
  if (strongPasswordHash) {
    return verifyPassword(password, strongPasswordHash);
  }

  const passwordHash = getAdminPasswordSha256();
  if (passwordHash) {
    return safeEqual(sha256(password), passwordHash);
  }

  return safeEqual(password, getAdminPassword());
}

export async function getAdminSession(currentUser?: UserProfile | null): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  if (isAdminSecurityConfigured()) {
    const token = cookieStore.get(getAdminCookieName())?.value || cookieStore.get(getAdminSiteCookieName())?.value;
    const legacySession = token ? parseSessionToken(token) : null;
    if (legacySession) {
      return legacySession;
    }
  }

  const { getCurrentUser } = await import("./user-auth");
  const user = currentUser === undefined ? await getCurrentUser() : currentUser;
  return user?.role === "admin" ? { username: user.username, expiresAt: Date.now() + 60_000 } : null;
}

export async function setAdminSession(username: string) {
  const cookieStore = await cookies();
  const maxAge = getAdminSessionTtlHours() * 60 * 60;
  const expiresAt = Date.now() + maxAge * 1000;
  const token = createSessionToken(username, expiresAt);
  cookieStore.set(getAdminCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge,
  });
  cookieStore.set(getAdminSiteCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  };
  cookieStore.set(getAdminCookieName(), "", { ...options, path: "/admin" });
  cookieStore.set(getAdminSiteCookieName(), "", { ...options, path: "/" });
}
