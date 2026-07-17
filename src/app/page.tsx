import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { recordSearchQuery } from "@/lib/analytics";
import { listNovels } from "@/lib/books";
import { getCatalogPageSize, isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const page = Number(params.page || "1");
  const query = params.q || "";
  const pageSize = getCatalogPageSize();
  const result = listNovels({ page, q: query, pageSize });
  const user = await getCurrentUser();
  const showTags = isTagLibraryEnabled() && (Boolean(user) || isGuestTagLibraryNavEnabled());
  const tagsByNovel = showTags ? listTagsForNovels(result.books.map((book) => book.id)) : new Map();
  if (result.query && !params.page) {
    recordSearchQuery(result.query, "title");
  }
  const returnParams = new URLSearchParams();
  returnParams.set("page", String(result.page));
  if (result.query) {
    returnParams.set("q", result.query);
  }
  const returnHref = `/?${returnParams.toString()}`;

  return (
    <main className="appShell catalogShell">
      <SiteHeader query={result.query} defaultSearchExpanded currentUser={user} />
      <section className="catalogSummary">
        <p>
          共 <strong>{result.totalBooks}</strong> 本，每页 {result.pageSize} 本
        </p>
      </section>

      {result.books.length > 0 ? (
        <CatalogBookGrid books={result.books} returnHref={returnHref} ariaLabel="小说列表" tagsByNovel={tagsByNovel} />
      ) : (
        <section className="emptyState">
          <h2>{result.message || "未找到匹配内容"}</h2>
        </section>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} query={result.query} />
    </main>
  );
}
