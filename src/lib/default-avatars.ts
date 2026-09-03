import crypto from "node:crypto";
import { getDb } from "./db";
import { generatedAvatarPath } from "./default-avatar-data";

type RandomBytes = (size: number) => Buffer;

/** Use 64 bits of entropy: enough variety without expanding stored markers. */
export function pickDefaultAvatar(randomBytes: RandomBytes = (size) => crypto.randomBytes(size)): string {
  return generatedAvatarPath(randomBytes(8).toString("hex"));
}

export function assignDefaultAvatarIfMissing(
  userId: number,
  currentAvatarPath: string | null,
  randomBytes: RandomBytes = (size) => crypto.randomBytes(size),
): string {
  if (currentAvatarPath?.trim()) {
    return currentAvatarPath;
  }

  const candidate = pickDefaultAvatar(randomBytes);
  const db = getDb();
  db.prepare(
    `UPDATE users
     SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND COALESCE(avatar_path, '') = ''`,
  ).run(candidate, userId);
  const row = db.prepare("SELECT avatar_path FROM users WHERE id = ?").get(userId) as {
    avatar_path: string | null;
  } | undefined;
  return row?.avatar_path || candidate;
}
