import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";

export function PageContextBar({
  items,
  children,
}: {
  items: BreadcrumbItem[];
  children?: ReactNode;
}) {
  return (
    <div className="pageContextBar">
      <Breadcrumbs items={items} />
      {children ? <div className="pageContextActions">{children}</div> : null}
    </div>
  );
}
