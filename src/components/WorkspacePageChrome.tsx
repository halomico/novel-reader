import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "@/components/LocalizedLink";

export function WorkspacePage({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <section className={`workspacePage${className ? ` ${className}` : ""}`}>{children}</section>;
}

export type WorkspaceTabItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
};

export function WorkspacePageHeader({
  className = "",
  icon: Icon,
  title,
  trailing,
}: {
  className?: string;
  icon: LucideIcon;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <header className={`userContentHeader workspacePageHeader${className ? ` ${className}` : ""}`}>
      <span className="workspacePageTitle"><Icon size={19} aria-hidden="true" /><h1>{title}</h1></span>
      {trailing || null}
    </header>
  );
}

export function WorkspacePrimaryTabs({
  items,
  label,
  className = "",
}: {
  items: WorkspaceTabItem[];
  label: string;
  className?: string;
}) {
  return (
    <nav className={`workspacePrimaryTabs${className ? ` ${className}` : ""}`} aria-label={label}>
      {items.map(({ href, label: itemLabel, icon: Icon, active }) => (
        <Link className={active ? "isActive" : ""} href={href} prefetch={!active} aria-current={active ? "page" : undefined} key={href}>
          <Icon size={14} aria-hidden="true" />
          <span>{itemLabel}</span>
        </Link>
      ))}
    </nav>
  );
}

export function WorkspaceSegmentedTabs({
  items,
  label,
  className = "",
}: {
  items: WorkspaceTabItem[];
  label: string;
  className?: string;
}) {
  return (
    <nav className={`workspaceSegmentedTabs${className ? ` ${className}` : ""}`} aria-label={label}>
      {items.map(({ href, label: itemLabel, icon: Icon, active }) => (
        <Link className={active ? "isActive" : ""} href={href} prefetch={!active} aria-current={active ? "page" : undefined} key={href}>
          <Icon size={14} aria-hidden="true" />
          <span>{itemLabel}</span>
        </Link>
      ))}
    </nav>
  );
}
