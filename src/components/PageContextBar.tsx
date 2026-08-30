import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";

export function PageContextBar({
  items,
  children,
  search,
}: {
  items: BreadcrumbItem[];
  children?: ReactNode;
  search?: ReactNode;
}) {
  return (
    <div className={search ? "pageContextBar hasMediaSearch" : "pageContextBar"}>
      <Breadcrumbs items={items} />
      {children || search ? (
        <div className="pageContextActions">
          {children}
          {search}
        </div>
      ) : null}
    </div>
  );
}
