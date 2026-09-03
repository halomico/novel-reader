import {
  generatedAvatarUrl,
  isGeneratedDefaultAvatar,
} from "@/lib/default-avatar-data";

/** One avatar renderer for uploaded images and deterministic Vue Color Avatar
 * SVG combinations. Legacy default markers are intentionally remapped to the
 * new generator, so existing accounts switch without a database migration. */
export function UserAvatar({
  userId,
  displayName,
  avatarPath,
  className = "",
  decorative = true,
}: {
  userId: number;
  displayName: string;
  avatarPath?: string | null;
  className?: string;
  decorative?: boolean;
}) {
  const classes = `userAvatar${className ? ` ${className}` : ""}`;
  const labelProps = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": `${displayName}的头像` };
  if (!isGeneratedDefaultAvatar(avatarPath)) {
    return (
      <span className={`${classes} hasImage`} {...labelProps}>
        <img src={avatarPath!} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  return (
    <span className={`${classes} isGenerated`} {...labelProps}>
      <img src={generatedAvatarUrl(userId, avatarPath)} alt="" loading="lazy" decoding="async" />
    </span>
  );
}
