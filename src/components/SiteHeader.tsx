import { BookOpen, Settings } from "lucide-react";
import Link from "next/link";
import {
  getNoticeDisplaySeconds,
  getSiteName,
  isUserLoginEnabled,
  isUserRegistrationEnabled,
  shouldNoticeStayVisibleAfterBlur,
} from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderUserMenu } from "./HeaderUserMenu";
import { ThemeToggle } from "./ThemeToggle";

export async function SiteHeader({
  query = "",
  defaultSearchMode = "title",
  showCurrentSearch = false,
}: {
  query?: string;
  defaultSearchMode?: "title" | "content" | "current";
  showCurrentSearch?: boolean;
}) {
  const siteName = getSiteName();
  const user = await getCurrentUser();
  const loginEnabled = isUserLoginEnabled();
  const registrationEnabled = isUserRegistrationEnabled();
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  return (
    <header className="siteHeader">
      <Link className="brand" href="/" aria-label="返回首页">
        <BookOpen size={24} aria-hidden="true" />
        <span>{siteName}</span>
      </Link>
      <div className="headerTools">
        <HeaderSearch
          query={query}
          defaultMode={defaultSearchMode}
          showCurrentSearch={showCurrentSearch}
          noticeDisplaySeconds={noticeDisplaySeconds}
          noticeStayVisibleAfterBlur={noticeStayVisibleAfterBlur}
        />
        <div className="headerActions">
          <ThemeToggle />
          <HeaderUserMenu user={user ? { displayName: user.displayName, avatarPath: user.avatarPath } : null} loginEnabled={loginEnabled} registrationEnabled={registrationEnabled} />
          <Link className="iconLink" href="/settings" aria-label="阅读设置" title="阅读设置">
            <Settings size={21} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
