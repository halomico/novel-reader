import { ContentFavoriteButton } from "./ContentFavoriteButton";

export function MediaFavoriteButton({
  mediaId,
  initialFavorite,
}: {
  mediaId: number;
  initialFavorite: boolean;
}) {
  return <ContentFavoriteButton collection="media" contentId={mediaId} initialFavorite={initialFavorite} />;
}
