import crypto from "node:crypto";
import { getDb } from "./db";

export const DEFAULT_AVATAR_PATHS = [
  "/default-avatars/01.svg",
  "/default-avatars/02.svg",
  "/default-avatars/03.svg",
  "/default-avatars/04.svg",
  "/default-avatars/05.svg",
  "/default-avatars/06.svg",
  "/default-avatars/07.svg",
  "/default-avatars/08.svg",
  "/default-avatars/09.svg",
  "/default-avatars/10.svg",
  "/default-avatars/11.svg",
  "/default-avatars/12.svg",
] as const;

type RandomInt = (maxExclusive: number) => number;

export function pickDefaultAvatar(randomInt: RandomInt = crypto.randomInt): string {
  return DEFAULT_AVATAR_PATHS[randomInt(DEFAULT_AVATAR_PATHS.length)];
}

export function assignDefaultAvatarIfMissing(
  userId: number,
  currentAvatarPath: string | null,
  randomInt: RandomInt = crypto.randomInt,
): string {
  if (currentAvatarPath?.trim()) {
    return currentAvatarPath;
  }

  const candidate = pickDefaultAvatar(randomInt);
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
