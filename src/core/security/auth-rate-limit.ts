import { checkRateLimit } from "@/lib/rate-limit";

type FailureState = { count: number; expiresAt: number };

const failures = new Map<string, FailureState>();
const MAX_FAILURE_KEYS = 20_000;
const FAILURE_TTL_MS = 15 * 60_000;

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").slice(0, 80) || "empty";
}

function failureKey(ip: string, username: string): string {
  return `${ip || "unknown"}:${normalizeIdentity(username)}`;
}

function cleanup(now: number): void {
  if (failures.size < MAX_FAILURE_KEYS) return;
  for (const [key, value] of failures) {
    if (value.expiresAt <= now) failures.delete(key);
  }
  while (failures.size >= MAX_FAILURE_KEYS) {
    const first = failures.keys().next().value as string | undefined;
    if (!first) break;
    failures.delete(first);
  }
}

export function checkLoginAttempt(ip: string, username: string, now = Date.now()): {
  allowed: boolean;
  retryAfterSeconds: number;
  challengeRequired: boolean;
} {
  cleanup(now);
  const identity = normalizeIdentity(username);
  const dimensions = [
    checkRateLimit({ key: `user-login:ip:${ip || "unknown"}`, limit: 10, windowMs: 60_000, now }),
    checkRateLimit({ key: `user-login:user:${identity}`, limit: 6, windowMs: 5 * 60_000, now }),
    checkRateLimit({ key: `user-login:pair:${ip || "unknown"}:${identity}`, limit: 5, windowMs: 5 * 60_000, now }),
  ];
  const blocked = dimensions.filter((result) => !result.allowed);
  return {
    allowed: blocked.length === 0,
    retryAfterSeconds: blocked.reduce((maximum, result) => Math.max(maximum, result.retryAfterSeconds), 0),
    challengeRequired: (failures.get(failureKey(ip, username))?.count || 0) >= 3,
  };
}

export function recordLoginFailure(ip: string, username: string, now = Date.now()): number {
  cleanup(now);
  const key = failureKey(ip, username);
  const current = failures.get(key);
  const count = current && current.expiresAt > now ? current.count + 1 : 1;
  failures.set(key, { count, expiresAt: now + FAILURE_TTL_MS });
  return count;
}

export function clearLoginFailures(ip: string, username: string): void {
  failures.delete(failureKey(ip, username));
}

export function loginChallengeRequired(ip: string, username: string, now = Date.now()): boolean {
  const current = failures.get(failureKey(ip, username));
  if (!current || current.expiresAt <= now) {
    if (current) failures.delete(failureKey(ip, username));
    return false;
  }
  return current.count >= 3;
}
