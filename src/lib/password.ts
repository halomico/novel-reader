import crypto from "node:crypto";

const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha256").toString("base64url");
  return `pbkdf2-sha256:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, iterationsText, salt, expectedHash] = storedHash.split(":");
  const iterations = Number(iterationsText);
  if (
    scheme !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 10_000 ||
    iterations > 2_000_000 ||
    !salt ||
    !expectedHash
  ) {
    return false;
  }

  const actualHash = crypto.pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, "sha256").toString("base64url");
  return timingSafeEqualText(actualHash, expectedHash);
}
