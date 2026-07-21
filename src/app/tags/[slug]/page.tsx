import { Tags } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { getCatalogPageSize, isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { getTagBySlug, listNovelsByTag, listTagsForNovels } from "@/lib/tags";
import { canonicalPagePath, NO_INDEX_ROBOTS } from "@/lib/seo";
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

export async function generateMetadata({ params, searchParams }: TagPageProps): Promise<Metadata> {
  const tag = getTagBySlug((await params).slug);
  if (!tag) {
    return { title: "标签不存在", robots: NO_INDEX_ROBOTS };
  }
  const pageValue = Number((await searchParams).page || 1);
  const page = Number.isInteger(pageValue) && pageValue > 1 ? pageValue : 1;
  const canonical = canonicalPagePath(`/tags/${tag.slug}`, page);
  const isPublic = isTagLibraryEnabled() && isGuestTagLibraryNavEnabled();
  const description = tag.description || `浏览“${tag.name}”标签下的小说。`;
  return {
    title: page > 1 ? `${tag.name} 第 ${page} 页` : tag.name,
    description,
    alternates: { canonical },
    robots: isPublic ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title: tag.name, description, url: canonical },
  };
}

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
          {tag.description ? <p className="tagDetailDescription">{tag.description}</p> : null}
          <div className="tagDetailMeta">
            {tag.aliases.length ? (
              <span>
                <small>别名</small>
                <strong>{tag.aliases.join("、")}</strong>
              </span>
            ) : null}
            <span>共 {result.totalBooks} 本小说</span>
          </div>
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
