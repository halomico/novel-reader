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
  isGuestTagLibraryNavEnabled,
  isNovelLibraryEnabled,
  isUserLoginEnabled,
  isUserRegistrationEnabled,
  isTagLibraryEnabled,
  isVideoLibraryEnabled,
  shouldNoticeStayVisibleAfterBlur,
} from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import type { UserProfile } from "@/lib/users";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderPrimaryNav } from "./HeaderPrimaryNav";
import { HeaderUserMenu } from "./HeaderUserMenu";
import { ThemeToggle } from "./ThemeToggle";

export async function SiteHeader({
  query = "",
  defaultSearchMode = "title",
  defaultSearchExpanded = false,
  showCurrentSearch = false,
  showPrimaryNavigation = true,
  showTools = true,
  isHomePage = false,
  currentUser,
}: {
  query?: string;
  defaultSearchMode?: "title" | "content" | "current";
  defaultSearchExpanded?: boolean;
  showCurrentSearch?: boolean;
  showPrimaryNavigation?: boolean;
  showTools?: boolean;
  isHomePage?: boolean;
  currentUser?: UserProfile | null;
}) {
  const siteName = getSiteName();
  const user = currentUser === undefined ? await getCurrentUser() : currentUser;
  const loginEnabled = isUserLoginEnabled();
  const registrationEnabled = isUserRegistrationEnabled();
  const enabledMediaKinds = [
    isVideoLibraryEnabled() ? "video" : null,
    isAudioLibraryEnabled() ? "audio" : null,
    isFileLibraryEnabled() ? "file" : null,
  ].filter((kind): kind is "video" | "audio" | "file" => kind !== null);
  const showLibraryNav = isNovelLibraryEnabled() && (Boolean(user) || isGuestLibraryNavEnabled());
  const showTagNav = isTagLibraryEnabled() && (Boolean(user) || isGuestTagLibraryNavEnabled());
  const mediaKinds = user
    ? enabledMediaKinds
    : enabledMediaKinds.filter((kind) => (
      kind === "video" ? isGuestVideoNavEnabled() : kind === "audio" ? isGuestAudioNavEnabled() : isGuestFileNavEnabled()
    ));
  const showPrimaryNav = showPrimaryNavigation && (showLibraryNav || showTagNav || mediaKinds.length > 0);
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  const headerClassName = ["siteHeader", showPrimaryNav ? "hasPrimaryNav" : "", isHomePage ? "isHomeHeader" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClassName}>
      <Link className="brand" href="/" aria-label="返回首页">
        <BookOpen size={24} aria-hidden="true" />
        <span>{siteName}</span>
      </Link>
      {showPrimaryNav ? <HeaderPrimaryNav mediaKinds={mediaKinds} showLibrary={showLibraryNav} showTags={showTagNav} /> : null}
      {showTools ? (
        <div className={showLibraryNav ? "headerTools" : "headerTools hasNoSearch"}>
          {showLibraryNav ? (
            <HeaderSearch
              query={query}
              defaultMode={defaultSearchMode}
              defaultExpanded={defaultSearchExpanded}
              showCurrentSearch={showCurrentSearch}
              noticeDisplaySeconds={noticeDisplaySeconds}
              noticeStayVisibleAfterBlur={noticeStayVisibleAfterBlur}
            />
          ) : null}
          <div className="headerActions">
            <ThemeToggle />
            <HeaderUserMenu
              user={user ? { displayName: user.displayName, avatarPath: user.avatarPath } : null}
              loginEnabled={loginEnabled}
              registrationEnabled={registrationEnabled}
              mediaKinds={mediaKinds}
              showLibrary={showLibraryNav}
              showTags={showTagNav}
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}
