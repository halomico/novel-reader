import { Check, FolderCog, LibraryBig, Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { AdminBookTable } from "@/components/AdminBookTable";
import { AdminBookUpload } from "@/components/AdminBookUpload";
import { AdminPinnedBooks } from "@/components/AdminPinnedBooks";
import { listAdminBooks } from "@/lib/admin-books";
import { getAdminBookPageSize } from "@/lib/config";
import { listPinnedNovels } from "@/lib/pinned-novels";
import { listNovelSources } from "@/lib/novel-library";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminBooksPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    sort?: string;
    dir?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
    sourceId?: string;
  }>;
};

export default async function AdminBooksPage({ searchParams }: AdminBooksPageProps) {
  const params = await searchParams;
  const uploadSources = listNovelSources({ includeEmpty: true });
  const sources = uploadSources.filter((source) => source.novelCount > 0);
  const requestedSourceId = Number(params.sourceId || 0);
  const sourceId = sources.some((source) => source.id === requestedSourceId) ? requestedSourceId : 0;
  const bookList = listAdminBooks({
    page: Number(params.page || "1"),
    q: params.q || "",
    pageSize: getAdminBookPageSize(),
    sort: params.sort,
    dir: params.dir,
    sourceId,
  });
  const pinnedBooks = listPinnedNovels();
  const returnParams = new URLSearchParams({
    page: String(bookList.page),
    sort: bookList.sort,
    dir: bookList.dir,
  });
  if (bookList.query) {
    returnParams.set("q", bookList.query);
  }
  if (sourceId) returnParams.set("sourceId", String(sourceId));
  const returnPath = `/admin/books?${returnParams.toString()}`;
  const activeSource = sources.find((source) => source.id === sourceId);
  function sourceHref(nextSourceId = 0) {
    const next = new URLSearchParams({ sort: bookList.sort, dir: bookList.dir });
    if (bookList.query) next.set("q", bookList.query);
    if (nextSourceId) next.set("sourceId", String(nextSourceId));
    return `/admin/books?${next.toString()}`;
  }

  return (
    <AdminFrame active="books" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminBookPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>小说管理</h2>
            <p>按书库导入、筛选和维护单文件或分章小说。</p>
          </div>
          <div className="adminBookHeaderTools">
            <Form className="adminBookFilterBar" action="/admin/books">
              <label className="adminBookSearchField">
                <Search size={16} aria-hidden="true" />
                <span className="srOnly">搜索小说</span>
                <input name="q" defaultValue={bookList.query} placeholder="搜索小说名称" />
              </label>
              <input name="sort" type="hidden" value={bookList.sort} />
              <input name="dir" type="hidden" value={bookList.dir} />
              {sourceId ? <input name="sourceId" type="hidden" value={sourceId} /> : null}
              <button className="adminBookSearchButton" type="submit" aria-label="搜索" title="搜索"><Search size={16} aria-hidden="true" /></button>
            </Form>
            <details className={activeSource ? "adminBookSourceFilter isActive" : "adminBookSourceFilter"}>
              <summary
                aria-label={activeSource ? `当前书库：${activeSource.name}` : "筛选书库"}
                title={activeSource ? `当前书库：${activeSource.name}` : "筛选书库"}
              >
                <LibraryBig size={16} aria-hidden="true" />
              </summary>
              <nav aria-label="书库筛选">
                <Link className={!activeSource ? "isActive" : ""} href={sourceHref()}>
                  <span>全部书库</span><small>{uploadSources.reduce((total, source) => total + source.novelCount, 0)}</small>
                  {!activeSource ? <Check size={14} aria-hidden="true" /> : null}
                </Link>
                {sources.map((source) => (
                  <Link className={source.id === sourceId ? "isActive" : ""} href={sourceHref(source.id)} key={source.id}>
                    <span>{source.name}</span><small>{source.novelCount}</small>
                    {source.id === sourceId ? <Check size={14} aria-hidden="true" /> : null}
                  </Link>
                ))}
              </nav>
            </details>
            <Link className="adminBookSourceManageButton" href="/admin/books/sources" aria-label="管理书库" title="管理书库">
              <FolderCog size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>

        {bookList.message ? <p className="adminInlineMessage">{bookList.message}</p> : null}

        <AdminPinnedBooks books={pinnedBooks} returnPath={returnPath} />
        <AdminBookUpload sources={uploadSources} initialSourceId={sourceId || undefined} />

        <AdminBookTable
          books={bookList.books}
          page={bookList.page}
          totalPages={bookList.totalPages}
          totalBooks={bookList.totalBooks}
          query={bookList.query}
          sort={bookList.sort}
          dir={bookList.dir}
          pinnedIds={pinnedBooks.map((book) => book.id)}
          returnPath={returnPath}
          sourceId={sourceId}
        />
        <Pagination
          page={bookList.page}
          totalPages={bookList.totalPages}
          query={bookList.query}
          basePath="/admin/books"
          extraParams={{ sort: bookList.sort, dir: bookList.dir, sourceId: sourceId ? String(sourceId) : undefined }}
        />
      </article>
    </AdminFrame>
  );
}
