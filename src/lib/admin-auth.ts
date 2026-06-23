import crypto from "node:crypto";
import { cookies } from "next/headers";
import {
  getAdminCookieName,
  getAdminPassword,
  getAdminPasswordSha256,
  getAdminSessionSecret,
  getAdminSessionTtlHours,
  getAdminUsername,
} from "./config";

export type AdminSession = {
  username: string;
  expiresAt: number;
};

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
  return crypto.createHmac("sha256", getAdminSessionSecret()).update(`${username}.${expiresAt}`).digest("hex");
}

function createSessionToken(username: string, expiresAt: number): string {
  const signature = signSession(username, expiresAt);
  return `${encodeURIComponent(username)}.${expiresAt}.${signature}`;
}

function parseSessionToken(token: string): AdminSession | null {
  const [encodedUsername, expiresText, signature] = token.split(".");
  let username = "";
  try {
    username = decodeURIComponent(encodedUsername || "");
  } catch {
    return null;
  }
  const expiresAt = Number(expiresText);

  if (!username || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !signature) {
    return null;
  }

  if (!safeEqual(signature, signSession(username, expiresAt))) {
    return null;
  }

  return { username, expiresAt };
}

export function isAdminSecurityConfigured(): boolean {
  return Boolean(getAdminSessionSecret() && (getAdminPassword() || getAdminPasswordSha256()));
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  if (!isAdminSecurityConfigured() || !safeEqual(username, getAdminUsername())) {
    return false;
  }

  const passwordHash = getAdminPasswordSha256();
  if (passwordHash) {
    return safeEqual(sha256(password), passwordHash);
  }

  return safeEqual(password, getAdminPassword());
}

export async function getAdminSession(): Promise<AdminSession | null> {
  if (!isAdminSecurityConfigured()) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(getAdminCookieName())?.value;
  if (!token) {
    return null;
  }
  return parseSessionToken(token);
}

export async function setAdminSession(username: string) {
  const cookieStore = await cookies();
  const maxAge = getAdminSessionTtlHours() * 60 * 60;
  const expiresAt = Date.now() + maxAge * 1000;
  cookieStore.set(getAdminCookieName(), createSessionToken(username, expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge,
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(getAdminCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0,
  });
}
