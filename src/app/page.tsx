import { BookText } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { listNovels, normalizePageSize } from "@/lib/books";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const headerStore = await headers();
  const cookieHeader = headerStore.get("cookie") || "";
  const pageSizeCookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("novel-page-size="))
    ?.split("=")[1];
  const page = Number(params.page || "1");
  const query = params.q || "";
  const pageSize = normalizePageSize(pageSizeCookie ? decodeURIComponent(pageSizeCookie) : undefined);
  const result = listNovels({ page, q: query, pageSize });
  const returnParams = new URLSearchParams();
  returnParams.set("page", String(result.page));
  if (result.query) {
    returnParams.set("q", result.query);
  }
  const returnHref = `/?${returnParams.toString()}`;

  return (
    <main className="appShell">
      <SiteHeader query={result.query} />
      <section className="catalogSummary">
        <p>
          共 <strong>{result.totalBooks}</strong> 本，每页 {result.pageSize} 本
        </p>
      </section>

      {result.books.length > 0 ? (
        <section className="bookGrid" aria-label="小说列表">
          {result.books.map((book) => (
            <Link className="bookCard" href={`/books/${book.id}?from=${encodeURIComponent(returnHref)}`} key={book.id}>
              <span className="bookMark" aria-hidden="true">
                <BookText size={20} />
              </span>
              <span className="bookTitle">{book.title}</span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="emptyState">
          <h2>还没有可显示的小说</h2>
          <p>把 `.txt` 文件放入配置的书库目录后，执行 `npm run scan:books`。</p>
        </section>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} query={result.query} />
    </main>
  );
}
