/** Browser-safe contract for generated default avatars. */
const GENERATED_AVATAR_PREFIX = "generated-avatar:";
const GENERATED_AVATAR_SEED = /^[a-f0-9]{1,16}$/;

function normalizedUserId(userId: number): number {
  return Number.isSafeInteger(userId) ? Math.abs(userId) : 0;
}

/** A stable seed for accounts that have not persisted a random selection yet. */
export function defaultAvatarSeedForUser(userId: number): string {
  return normalizedUserId(userId).toString(16);
}

export function generatedAvatarPath(seed: string): string {
  const normalized = seed.trim().toLocaleLowerCase();
  if (!GENERATED_AVATAR_SEED.test(normalized)) {
    throw new Error("Invalid generated avatar seed");
  }
  return `${GENERATED_AVATAR_PREFIX}${normalized}`;
}

export function isGeneratedAvatarPath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLocaleLowerCase();
  return normalized.startsWith(GENERATED_AVATAR_PREFIX)
    && GENERATED_AVATAR_SEED.test(normalized.slice(GENERATED_AVATAR_PREFIX.length));
}

/** The seed an account's avatar is drawn from: its own marker, or one derived from the
 *  account id for someone who has never chosen. */
export function generatedAvatarSeed(userId: number, avatarPath?: string | null): string {
  const current = avatarPath?.trim().toLocaleLowerCase() || "";
  return isGeneratedAvatarPath(current)
    ? current.slice(GENERATED_AVATAR_PREFIX.length)
    : defaultAvatarSeedForUser(userId);
}

export function isGeneratedDefaultAvatar(avatarPath: string | null | undefined): boolean {
  const value = avatarPath?.trim() || "";
  return !value || isGeneratedAvatarPath(value);
}

export function generatedAvatarUrl(userId: number, avatarPath?: string | null): string {
  const id = normalizedUserId(userId);
  return `/api/avatars/${id}-${generatedAvatarSeed(id, avatarPath)}.svg`;
}
