import { BookOpen } from "lucide-react";
import Link from "@/components/LocalizedLink";
import {
  canAccessAdvancedTagSearch,
  getNoticeDisplaySeconds,
  getSiteBrandHref,
  getSiteName,
  isGuestAudioNavEnabled,
  isGuestFileNavEnabled,
  isGuestLibraryNavEnabled,
  isGuestVideoNavEnabled,
  isAudioLibraryEnabled,
  isFileLibraryEnabled,
  isGuestTagLibraryNavEnabled,
  isMarketEnabled,
  isNovelLibraryEnabled,
  isUserLoginEnabled,
  isUserRegistrationEnabled,
  isTagLibraryEnabled,
  isVideoLibraryEnabled,
} from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import type { UserProfile } from "@/lib/users";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { countUserUnreadMessages } from "@/lib/station";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderPrimaryNav } from "./HeaderPrimaryNav";
import { ReaderHeaderBehavior } from "./ReaderHeaderBehavior";
import { HeaderUserMenu } from "./HeaderUserMenu";
import { ThemeToggle } from "./ThemeToggle";

export async function SiteHeader({
  query = "",
  defaultSearchMode = "title",
  defaultSearchExpanded = false,
  showCurrentSearch = false,
  showPrimaryNavigation = true,
  showTools = true,
  showSearch = true,
  isHomePage = false,
  readerMode = false,
  authMode = false,
  library = "default",
  currentUser,
  unreadMessages,
}: {
  query?: string;
  defaultSearchMode?: "title" | "content" | "current";
  defaultSearchExpanded?: boolean;
  showCurrentSearch?: boolean;
  showPrimaryNavigation?: boolean;
  showTools?: boolean;
  showSearch?: boolean;
  isHomePage?: boolean;
  readerMode?: boolean;
  authMode?: boolean;
  library?: string;
  currentUser?: UserProfile | null;
  unreadMessages?: number;
}) {
  const locale = await getRequestLocale();
  const siteName = await localizeText(getSiteName(), locale);
  const [homeLabel, novelsLabel] = await localizeTexts(
    ["返回首页", "前往小说"] as const,
    locale,
  );
  const brandHref = getSiteBrandHref();
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
  const unreadCount = user ? unreadMessages ?? countUserUnreadMessages(user.id) : 0;
  const showAdvancedSearch = canAccessAdvancedTagSearch(false) ||
    (canAccessAdvancedTagSearch(Boolean(user)) && hasUserPermission(user, "advanced_search"));
  const showMarket = Boolean(user && isMarketEnabled() && hasUserPermission(user, "market_access"));
  const canShowSearch = showSearch && showLibraryNav && !authMode;

  const headerClassName = [
    "siteHeader",
    showPrimaryNav ? "hasPrimaryNav" : "",
    isHomePage ? "isHomeHeader" : "",
    readerMode ? "readerSiteHeader" : "",
    authMode ? "isAuthHeader" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClassName}>
        <Link className="brand" href={brandHref} aria-label={brandHref === "/novels" ? novelsLabel : homeLabel}>
          <BookOpen size={24} aria-hidden="true" />
          <span>{siteName}</span>
        </Link>
        {readerMode ? <ReaderHeaderBehavior /> : null}
        {showPrimaryNav ? <HeaderPrimaryNav mediaKinds={mediaKinds} showLibrary={showLibraryNav} showTags={showTagNav} /> : null}
        {showTools ? (
          <div className={canShowSearch ? "headerTools" : "headerTools hasNoSearch"}>
            {canShowSearch ? (
              <HeaderSearch
                query={query}
                defaultMode={defaultSearchMode}
                defaultExpanded={defaultSearchExpanded}
                showCurrentSearch={showCurrentSearch}
                showAdvancedSearch={showAdvancedSearch}
                noticeDisplaySeconds={noticeDisplaySeconds}
                library={library}
              />
            ) : null}
            <div className="headerActions">
              {!readerMode ? <ThemeToggle /> : null}
              <HeaderUserMenu
                user={user ? {
                  displayName: user.displayName,
                  avatarPath: user.avatarPath,
                  trustLevel: user.trustLevel,
                } : null}
                unreadMessages={unreadCount}
                loginEnabled={loginEnabled}
                registrationEnabled={registrationEnabled}
                showMarket={showMarket}
              />
            </div>
          </div>
        ) : null}
    </header>
  );
}
