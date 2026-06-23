import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

type PageItem = number | "ellipsis";

function pageHref(page: number, query: string, basePath: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (query) {
    params.set("q", query);
  }
  return `${basePath}?${params.toString()}`;
}

function getPageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: PageItem[] = [1];
  const start = page <= 3 ? 2 : page >= totalPages - 2 ? Math.max(2, totalPages - 4) : Math.max(2, page - 1);
  const end = page <= 3 ? Math.min(5, totalPages - 1) : page >= totalPages - 2 ? totalPages - 1 : Math.min(totalPages - 1, page + 2);

  if (start > 2) {
    items.push("ellipsis");
  }

  for (let item = start; item <= end; item += 1) {
    items.push(item);
  }

  if (end < totalPages - 1) {
    items.push("ellipsis");
  }

  items.push(totalPages);
  return items;
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
  const pageItems = getPageItems(page, totalPages);

  if (totalPages <= 1) {
    return null;
  }

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

      <div className="pageList" aria-label={`第 ${page} 页，共 ${totalPages} 页`}>
        {pageItems.map((item, index) =>
          item === "ellipsis" ? (
            <span className="pageEllipsis" aria-hidden="true" key={`ellipsis-${index}`}>
              …
            </span>
          ) : item === page ? (
            <span className="pageNumber isActive" aria-current="page" key={item}>
              {item}
            </span>
          ) : (
            <Link className="pageNumber" href={pageHref(item, query, basePath)} key={item} aria-label={`第 ${item} 页`}>
              {item}
            </Link>
          ),
        )}
      </div>

      {canGoNext ? (
        <Link className="pageButton" href={pageHref(page + 1, query, basePath)} aria-label="下一页">
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      ) : (
        <span className="pageButton isDisabled" aria-hidden="true">
          <ChevronRight size={18} />
        </span>
      )}
    </nav>
  );
}
