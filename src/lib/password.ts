import crypto from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(crypto.pbkdf2);
const scryptAsync = promisify(crypto.scrypt);

const LEGACY_PASSWORD_KEY_LENGTH = 32;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const PASSWORD_CONCURRENCY = Math.min(Math.max(Number(process.env.PASSWORD_VERIFY_CONCURRENCY) || 4, 2), 8);
const DUMMY_SALT = Buffer.from("novel-reader-fixed-dummy-salt-v1", "utf8");

let activePasswordJobs = 0;
const waiters: Array<() => void> = [];

async function withPasswordSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activePasswordJobs >= PASSWORD_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activePasswordJobs += 1;
  try {
    return await operation();
  } finally {
    activePasswordJobs -= 1;
    waiters.shift()?.();
  }
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function deriveScrypt(password: string, salt: Buffer, n = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P): Promise<Buffer> {
  return withPasswordSlot(async () => Buffer.from(await scryptAsync(password, salt, SCRYPT_KEY_LENGTH, {
    N: n,
    r,
    p,
    maxmem: Math.max(SCRYPT_MAXMEM, 128 * n * r + 1024 * 1024),
  })));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await deriveScrypt(password, salt);
  return `scrypt:v1:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

async function verifyScrypt(password: string, storedHash: string): Promise<boolean> {
  const [scheme, version, nText, rText, pText, saltText, expectedHash] = storedHash.split(":");
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (
    scheme !== "scrypt" || version !== "v1" || !Number.isInteger(n) || !Number.isInteger(r) ||
    !Number.isInteger(p) || n < 1 << 14 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16 ||
    !saltText || !expectedHash
  ) return false;
  try {
    const actual = await deriveScrypt(password, Buffer.from(saltText, "base64url"), n, r, p);
    return timingSafeEqualText(actual.toString("base64url"), expectedHash);
  } catch {
    return false;
  }
}

async function verifyLegacyPbkdf2(password: string, storedHash: string): Promise<boolean> {
  const [scheme, iterationsText, salt, expectedHash] = storedHash.split(":");
  const iterations = Number(iterationsText);
  if (
    scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 10_000 ||
    iterations > 2_000_000 || !salt || !expectedHash
  ) return false;
  try {
    const actual = await withPasswordSlot(async () => pbkdf2Async(
      password,
      salt,
      iterations,
      LEGACY_PASSWORD_KEY_LENGTH,
      "sha256",
    ));
    return timingSafeEqualText(Buffer.from(actual).toString("base64url"), expectedHash);
  } catch {
    return false;
  }
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) {
    await deriveScrypt(password, DUMMY_SALT);
    return false;
  }
  if (storedHash.startsWith("scrypt:")) return verifyScrypt(password, storedHash);
  if (storedHash.startsWith("pbkdf2-sha256:")) return verifyLegacyPbkdf2(password, storedHash);
  await deriveScrypt(password, DUMMY_SALT);
  return false;
}

export function passwordNeedsRehash(storedHash: string): boolean {
  if (!storedHash.startsWith("scrypt:v1:")) return true;
  const [, , nText, rText, pText] = storedHash.split(":");
  return Number(nText) !== SCRYPT_N || Number(rText) !== SCRYPT_R || Number(pText) !== SCRYPT_P;
}
