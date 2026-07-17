import { Tags } from "lucide-react";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { getCatalogPageSize, isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { getTagBySlug, listNovelsByTag, listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type TagPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    page?: string;
  }>;
};

function TagsLocked() {
  return (
    <main className="appShell">
      <SiteHeader currentUser={null} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "标签" }]} />
      <section className="emptyState">
        <h2>登录后可查看标签</h2>
      </section>
    </main>
  );
}

export default async function TagPage({ params, searchParams }: TagPageProps) {
  if (!isTagLibraryEnabled()) {
    notFound();
  }
  const user = await getCurrentUser();
  if (!user && !isGuestTagLibraryNavEnabled()) {
    return <TagsLocked />;
  }
  const { slug } = await params;
  const query = await searchParams;
  const tag = getTagBySlug(slug);
  if (!tag) {
    notFound();
  }
  const result = listNovelsByTag(tag.id, {
    page: Number(query.page || "1"),
    pageSize: getCatalogPageSize(),
  });
  const tagsByNovel = listTagsForNovels(result.books.map((book) => book.id));
  const returnHref = `/tags/${tag.slug}?page=${result.page}`;

  return (
    <main className="appShell catalogShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "标签", href: "/tags" }, { label: tag.name }]} />
      <section className="tagDetailHeader">
        <span className="tagLibraryIcon" aria-hidden="true">
          <Tags size={23} />
        </span>
        <div>
          <h1>{tag.name}</h1>
          <p>共 {result.totalBooks} 本小说</p>
        </div>
      </section>

      {result.books.length > 0 ? (
        <CatalogBookGrid
          books={result.books}
          returnHref={returnHref}
          ariaLabel={`${tag.name} 标签小说列表`}
          tagsByNovel={tagsByNovel}
        />
      ) : (
        <section className="emptyState">
          <h2>这个标签下暂无小说</h2>
        </section>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} query="" basePath={`/tags/${tag.slug}`} />
    </main>
  );
}
