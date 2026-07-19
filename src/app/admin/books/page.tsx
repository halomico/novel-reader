import { Search } from "lucide-react";
import type { Metadata } from "next";
import { Pagination } from "@/components/Pagination";
import { AdminBookTable } from "@/components/AdminBookTable";
import { AdminBookUpload } from "@/components/AdminBookUpload";
import { AdminPinnedBooks } from "@/components/AdminPinnedBooks";
import { listAdminBooks } from "@/lib/admin-books";
import { getAdminBookPageSize } from "@/lib/config";
import { listPinnedNovels } from "@/lib/pinned-novels";
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
  }>;
};

export default async function AdminBooksPage({ searchParams }: AdminBooksPageProps) {
  const params = await searchParams;
  const bookList = listAdminBooks({
    page: Number(params.page || "1"),
    q: params.q || "",
    pageSize: getAdminBookPageSize(),
    sort: params.sort,
    dir: params.dir,
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
  const returnPath = `/admin/books?${returnParams.toString()}`;

  return (
    <AdminFrame active="books" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminBookPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>小说管理</h2>
            <p>添加、筛选和批量删除小说目录里的 `.txt` 文件。</p>
          </div>
          <form className="adminTitleSearchForm" action="/admin/books">
            <Search size={17} aria-hidden="true" />
            <input name="q" defaultValue={bookList.query} placeholder="搜索书名，支持 AND / OR / NOT" />
            <input name="sort" type="hidden" value={bookList.sort} />
            <input name="dir" type="hidden" value={bookList.dir} />
            <button type="submit">搜索</button>
          </form>
        </div>

        {bookList.message ? <p className="adminInlineMessage">{bookList.message}</p> : null}

        <AdminPinnedBooks books={pinnedBooks} returnPath={returnPath} />
        <AdminBookUpload />

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
        />
        <Pagination
          page={bookList.page}
          totalPages={bookList.totalPages}
          query={bookList.query}
          basePath="/admin/books"
          extraParams={{ sort: bookList.sort, dir: bookList.dir }}
        />
      </article>
    </AdminFrame>
  );
}
