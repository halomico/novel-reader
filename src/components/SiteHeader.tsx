import { BookOpen, Settings } from "lucide-react";
import Link from "next/link";
import { getSiteName } from "@/lib/config";
import { HeaderSearch } from "./HeaderSearch";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader({
  query = "",
  defaultSearchMode = "title",
}: {
  query?: string;
  defaultSearchMode?: "title" | "content";
}) {
  const siteName = getSiteName();

  return (
    <header className="siteHeader">
      <Link className="brand" href="/" aria-label="返回首页">
        <BookOpen size={24} aria-hidden="true" />
        <span>{siteName}</span>
      </Link>
      <HeaderSearch query={query} defaultMode={defaultSearchMode} />
      <div className="headerActions">
        <ThemeToggle />
        <Link className="iconLink" href="/settings" aria-label="阅读设置" title="阅读设置">
          <Settings size={21} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
