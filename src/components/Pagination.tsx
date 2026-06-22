import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

function pageHref(page: number, query: string, basePath: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (query) {
    params.set("q", query);
  }
  return `${basePath}?${params.toString()}`;
}

export function Pagination({
  page,
  totalPages,
  query,
  basePath = "/",
}: {
  page: number;
  totalPages: number;
  query: string;
  basePath?: string;
}) {
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  return (
    <nav className="pagination" aria-label="小说列表分页">
      {canGoPrev ? (
        <Link className="pageButton" href={pageHref(page - 1, query, basePath)} aria-label="上一页">
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
      ) : (
        <span className="pageButton isDisabled" aria-hidden="true">
          <ChevronLeft size={18} />
        </span>
      )}

      <span className="pageStatus">
        第 {page} / {totalPages} 页
      </span>

      {canGoNext ? (
        <Link className="pageButton" href={pageHref(page + 1, query, basePath)} aria-label="下一页">
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      ) : (
        <span className="pageButton isDisabled" aria-hidden="true">
          <ChevronRight size={18} />
        </span>
      )}

      <form className="jumpForm" action={basePath}>
        {query ? <input type="hidden" name="q" value={query} /> : null}
        <label htmlFor="jump-page">跳至</label>
        <input id="jump-page" name="page" type="number" min="1" max={totalPages} defaultValue={page} />
        <button type="submit">确定</button>
      </form>
    </nav>
  );
}
