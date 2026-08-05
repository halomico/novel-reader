import Link from "@/components/LocalizedLink";
import { cookies } from "next/headers";
import {
  canAccessAdvancedTagSearch,
  getDefaultNovelLibrarySlug,
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
import { novelLibraryPreferenceCookieName } from "@/lib/novel-library-scope";
import { isNovelSourceFullTextSearchEnabled } from "@/lib/novel-search-policy";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderMediaSearch } from "./HeaderMediaSearch";
import { HeaderPrimaryNav } from "./HeaderPrimaryNav";
import { ReaderHeaderBehavior } from "./ReaderHeaderBehavior";
import { HeaderUserMenu } from "./HeaderUserMenu";
import { MobileContextBackLink } from "./MobileContextBackLink";
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
  library,
  currentSearchBookId,
  currentUser,
  unreadMessages,
  mobileBackHref,
  mobileBackLabel = "返回上一级",
  mediaSearchKind,
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
  currentSearchBookId?: number;
  currentUser?: UserProfile | null;
  unreadMessages?: number;
  mobileBackHref?: string;
  mobileBackLabel?: string;
  mediaSearchKind?: "video" | "audio" | "file";
}) {
  const locale = await getRequestLocale();
  const siteName = await localizeText(getSiteName(), locale);
  const [homeLabel, novelsLabel] = await localizeTexts(
    ["返回首页", "前往小说"] as const,
    locale,
  );
  const brandHref = getSiteBrandHref();
  const user = currentUser === undefined ? await getCurrentUser() : currentUser;
  const rememberedLibrary = library === undefined && user
    ? (await cookies()).get(novelLibraryPreferenceCookieName(user.id))?.value
    : undefined;
  const activeLibrary = library || rememberedLibrary || getDefaultNovelLibrarySlug();
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
  const canShowNovelSearch = showSearch && !authMode && (readerMode || showLibraryNav);
  const canShowSearch = Boolean(mediaSearchKind) || canShowNovelSearch;
  const contentSearchEnabled = activeLibrary === "all" || isNovelSourceFullTextSearchEnabled(activeLibrary);

  const headerClassName = [
    "siteHeader",
    showPrimaryNav ? "hasPrimaryNav" : "",
    isHomePage ? "isHomeHeader" : "",
    readerMode ? "readerSiteHeader" : "",
    authMode ? "isAuthHeader" : "",
    mobileBackHref ? "hasMobileContext" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClassName}>
        {mobileBackHref ? (
          <div className="mobileContextHeader">
            <MobileContextBackLink href={mobileBackHref} label={mobileBackLabel} />
          </div>
        ) : null}
        <Link className="brand" href={brandHref} aria-label={brandHref === "/novels" ? novelsLabel : homeLabel}>
          <span>{siteName}</span>
        </Link>
        {readerMode ? <ReaderHeaderBehavior /> : null}
        {showPrimaryNav ? <HeaderPrimaryNav mediaKinds={mediaKinds} showLibrary={showLibraryNav} showTags={showTagNav} /> : null}
        {showTools ? (
          <div className={canShowSearch ? "headerTools" : "headerTools hasNoSearch"}>
            {mediaSearchKind ? (
              <HeaderMediaSearch kind={mediaSearchKind} />
            ) : canShowNovelSearch ? (
              <HeaderSearch
                query={query}
                defaultMode={defaultSearchMode}
                defaultExpanded={defaultSearchExpanded}
                showCurrentSearch={showCurrentSearch}
                showAdvancedSearch={showAdvancedSearch}
                noticeDisplaySeconds={noticeDisplaySeconds}
                library={activeLibrary}
                contentSearchEnabled={contentSearchEnabled}
                currentSearchBookId={currentSearchBookId}
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
