import { IntentPrefetchLink as Link } from "@/components/IntentPrefetchLink";
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
  isNovelCatalogSearchExpandedByDefault,
  isOriginalChannelEntryVisible,
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
import {
  NOVEL_CATALOG_SEARCH_COOKIE,
  normalizeNovelCatalogSearchExpanded,
} from "@/lib/ui-preferences";
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
  novelCatalogSearch = false,
  showCurrentSearch = false,
  showPrimaryNavigation = true,
  showTools = true,
  showSearch = true,
  isHomePage = false,
  readerMode = false,
  readerAutoHideOnScroll = true,
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
  novelCatalogSearch?: boolean;
  showCurrentSearch?: boolean;
  showPrimaryNavigation?: boolean;
  showTools?: boolean;
  showSearch?: boolean;
  isHomePage?: boolean;
  readerMode?: boolean;
  readerAutoHideOnScroll?: boolean;
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
  const cookieStore = (library === undefined && user) || novelCatalogSearch ? await cookies() : null;
  const rememberedLibrary = library === undefined && user
    ? cookieStore?.get(novelLibraryPreferenceCookieName(user.id))?.value
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
  const showOriginalNav = isOriginalChannelEntryVisible(Boolean(user));
  const mediaKinds = user
    ? enabledMediaKinds
    : enabledMediaKinds.filter((kind) => (
      kind === "video" ? isGuestVideoNavEnabled() : kind === "audio" ? isGuestAudioNavEnabled() : isGuestFileNavEnabled()
    ));
  const showPrimaryNav = showPrimaryNavigation && (showLibraryNav || showTagNav || showOriginalNav || mediaKinds.length > 0);
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const unreadCount = user ? unreadMessages ?? countUserUnreadMessages(user.id) : 0;
  const showAdvancedSearch = canAccessAdvancedTagSearch(false) ||
    (canAccessAdvancedTagSearch(Boolean(user)) && hasUserPermission(user, "advanced_search"));
  const showMarket = Boolean(user && isMarketEnabled() && hasUserPermission(user, "market_access"));
  const canShowNovelSearch = showSearch && !authMode && (readerMode || showLibraryNav);
  const canShowSearch = Boolean(mediaSearchKind) || canShowNovelSearch;
  const contentSearchEnabled = activeLibrary === "all" || isNovelSourceFullTextSearchEnabled(activeLibrary);
  const resolvedSearchExpanded = novelCatalogSearch
    ? normalizeNovelCatalogSearchExpanded(
        cookieStore?.get(NOVEL_CATALOG_SEARCH_COOKIE)?.value,
        isNovelCatalogSearchExpandedByDefault(),
      )
    : defaultSearchExpanded;

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
        {readerMode ? <ReaderHeaderBehavior hideOnScroll={readerAutoHideOnScroll} /> : null}
        {showPrimaryNav ? <HeaderPrimaryNav mediaKinds={mediaKinds} showLibrary={showLibraryNav} showTags={showTagNav} showOriginal={showOriginalNav} /> : null}
        {showTools ? (
          <div className={canShowSearch ? "headerTools" : "headerTools hasNoSearch"}>
            {mediaSearchKind ? (
              <HeaderMediaSearch kind={mediaSearchKind} />
            ) : canShowNovelSearch ? (
              <HeaderSearch
                query={query}
                defaultMode={defaultSearchMode}
                defaultExpanded={resolvedSearchExpanded}
                showCurrentSearch={showCurrentSearch}
                showAdvancedSearch={showAdvancedSearch}
                noticeDisplaySeconds={noticeDisplaySeconds}
                library={activeLibrary}
                contentSearchEnabled={contentSearchEnabled}
                currentSearchBookId={currentSearchBookId}
                persistCatalogPreference={novelCatalogSearch}
              />
            ) : null}
            <div className="headerActions">
              {!readerMode ? <ThemeToggle /> : null}
              <HeaderUserMenu
                user={user ? {
                  id: user.id,
                  displayName: user.displayName,
                  avatarPath: user.avatarPath,
                  trustLevel: user.trustLevel,
                } : null}
                unreadMessages={unreadCount}
                loginEnabled={loginEnabled}
                registrationEnabled={registrationEnabled}
                showMarket={showMarket}
                showOriginal={showOriginalNav}
              />
            </div>
          </div>
        ) : null}
    </header>
  );
}
