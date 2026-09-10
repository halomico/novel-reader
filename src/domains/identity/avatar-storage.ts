import fs from "node:fs";
import path from "node:path";

export function removeUserAvatarFile(avatarPath: string | null): boolean {
  if (!avatarPath?.startsWith("/avatars/")) return false;
  const avatarRoot = path.resolve(process.cwd(), "public", "avatars");
  const filePath = path.resolve(avatarRoot, avatarPath.slice("/avatars/".length));
  if (filePath === avatarRoot || !filePath.startsWith(`${avatarRoot}${path.sep}`) || !fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
