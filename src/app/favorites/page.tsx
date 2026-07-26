import { Bookmark } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getCatalogPageSize, isTagLibraryEnabled } from "@/lib/config";
import { listFavoriteNovels } from "@/lib/favorites";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { filterTagsByNovelForUser } from "@/lib/tag-preferences";
import { listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "收藏", robots: NO_INDEX_ROBOTS };

export default async function FavoritesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const result = listFavoriteNovels(user.id, Number(params.page || 1), getCatalogPageSize());
  const sourceTags = isTagLibraryEnabled()
    ? listTagsForNovels(result.books.map((book) => book.id), { audience: user.role === "admin" ? "admin" : "member" })
    : new Map();
  const tagsByNovel = filterTagsByNovelForUser(sourceTags, user.id);
  const returnHref = `/favorites?page=${result.page}`;

  return (
    <UserWorkspace user={user} active="favorites" breadcrumb="收藏">
      <section className="favoriteLibrary">
        <header className="userContentHeader">
          <span><Bookmark size={19} aria-hidden="true" /><h1>收藏</h1></span>
          <ResultCount count={result.totalBooks} />
        </header>
        {result.books.length ? (
          <CatalogBookGrid books={result.books} returnHref={returnHref} ariaLabel="收藏小说" tagsByNovel={tagsByNovel} />
        ) : (
          <div className="messageEmpty">还没有收藏小说</div>
        )}
        <Pagination page={result.page} totalPages={result.totalPages} query="" basePath="/favorites" />
      </section>
    </UserWorkspace>
  );
}
