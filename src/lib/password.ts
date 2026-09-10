import crypto from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(crypto.pbkdf2);

const LEGACY_PASSWORD_KEY_LENGTH = 32;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

const PASSWORD_CONCURRENCY = boundedInteger(process.env.PASSWORD_VERIFY_CONCURRENCY, 4, 1, 8);
const PASSWORD_QUEUE_LIMIT = boundedInteger(process.env.PASSWORD_VERIFY_QUEUE_LIMIT, 32, 1, 256);
const PASSWORD_QUEUE_TIMEOUT_MS = boundedInteger(process.env.PASSWORD_VERIFY_QUEUE_TIMEOUT_MS, 5_000, 250, 30_000);
const DUMMY_SALT = Buffer.from("novel-reader-fixed-dummy-salt-v1", "utf8");

let activePasswordJobs = 0;
type PasswordWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};
const waiters: PasswordWaiter[] = [];

export class PasswordVerificationUnavailableError extends Error {
  constructor(message = "Password verification is temporarily unavailable") {
    super(message);
    this.name = "PasswordVerificationUnavailableError";
  }
}

async function acquirePasswordSlot(): Promise<void> {
  if (activePasswordJobs < PASSWORD_CONCURRENCY) {
    activePasswordJobs += 1;
    return;
  }
  if (waiters.length >= PASSWORD_QUEUE_LIMIT) {
    throw new PasswordVerificationUnavailableError("Password verification queue is full");
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = {} as PasswordWaiter;
    waiter.resolve = resolve;
    waiter.reject = reject;
    waiter.timeout = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new PasswordVerificationUnavailableError("Password verification queue timed out"));
    }, PASSWORD_QUEUE_TIMEOUT_MS);
    waiter.timeout.unref?.();
    waiters.push(waiter);
  });
}

function releasePasswordSlot(): void {
  const waiter = waiters.shift();
  if (waiter) {
    clearTimeout(waiter.timeout);
    // Transfer this slot directly to the oldest waiter; active count remains
    // unchanged so a newly arriving request cannot overtake the queue.
    waiter.resolve();
    return;
  }
  activePasswordJobs = Math.max(0, activePasswordJobs - 1);
}

async function withPasswordSlot<T>(operation: () => Promise<T>): Promise<T> {
  await acquirePasswordSlot();
  try {
    return await operation();
  } finally {
    releasePasswordSlot();
  }
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function deriveScrypt(password: string, salt: Buffer, n = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P): Promise<Buffer> {
  return withPasswordSlot(() => scryptAsync(password, salt, SCRYPT_KEY_LENGTH, {
    N: n,
    r,
    p,
    maxmem: Math.max(SCRYPT_MAXMEM, 128 * n * r + 1024 * 1024),
  }));
}

export async function hashPasswordAsync(password: string): Promise<string> {
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
  } catch (error) {
    if (error instanceof PasswordVerificationUnavailableError) throw error;
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
  } catch (error) {
    if (error instanceof PasswordVerificationUnavailableError) throw error;
    return false;
  }
}

export async function verifyPasswordAsync(password: string, storedHash: string | null | undefined): Promise<boolean> {
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
