import { ContentFavoriteButton } from "./ContentFavoriteButton";

export function NovelFavoriteButton({
  novelId,
  initialFavorite,
  showLabel = false,
}: {
  novelId: number;
  initialFavorite: boolean;
  showLabel?: boolean;
}) {
  return <ContentFavoriteButton collection="novels" contentId={novelId} initialFavorite={initialFavorite} showLabel={showLabel} />;
}
