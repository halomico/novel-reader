import { BookOpen } from "lucide-react";
import Link from "next/link";
import {
  getNoticeDisplaySeconds,
  getSiteName,
  isGuestAudioNavEnabled,
  isGuestFileNavEnabled,
  isGuestLibraryNavEnabled,
  isGuestVideoNavEnabled,
  isAudioLibraryEnabled,
  isFileLibraryEnabled,
  isUserLoginEnabled,
  isUserRegistrationEnabled,
  isVideoLibraryEnabled,
  shouldNoticeStayVisibleAfterBlur,
} from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderPrimaryNav } from "./HeaderPrimaryNav";
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
  const enabledMediaKinds = [
    isVideoLibraryEnabled() ? "video" : null,
    isAudioLibraryEnabled() ? "audio" : null,
    isFileLibraryEnabled() ? "file" : null,
  ].filter((kind): kind is "video" | "audio" | "file" => kind !== null);
  const showLibraryNav = Boolean(user) || isGuestLibraryNavEnabled();
  const mediaKinds = user
    ? enabledMediaKinds
    : enabledMediaKinds.filter((kind) => (
      kind === "video" ? isGuestVideoNavEnabled() : kind === "audio" ? isGuestAudioNavEnabled() : isGuestFileNavEnabled()
    ));
  const showPrimaryNav = showLibraryNav || mediaKinds.length > 0;
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  return (
    <header className={showPrimaryNav ? "siteHeader hasPrimaryNav" : "siteHeader"}>
      <Link className="brand" href="/" aria-label="返回首页">
        <BookOpen size={24} aria-hidden="true" />
        <span>{siteName}</span>
      </Link>
      {showPrimaryNav ? <HeaderPrimaryNav mediaKinds={mediaKinds} showLibrary={showLibraryNav} /> : null}
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
          <HeaderUserMenu
            user={user ? { displayName: user.displayName, avatarPath: user.avatarPath } : null}
            loginEnabled={loginEnabled}
            registrationEnabled={registrationEnabled}
          />
        </div>
      </div>
    </header>
  );
}
