import { AppLink as Link } from "@/components/AppLink";
import { cookies } from "next/headers";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { isHomePortalEntryVisible } from "@/lib/home-portal";
import { getCurrentUser } from "@/lib/user-auth";
import type { PostgresUserProfile as UserProfile } from "@/domains/identity/postgres-users";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { getUserNavigationState } from "@/lib/user-navigation";
import { novelLibraryPreferenceCookieName } from "@/lib/novel-library-scope";
import {
  NOVEL_CATALOG_SEARCH_COOKIE,
  normalizeNovelCatalogSearchExpanded,
} from "@/lib/ui-preferences";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderPrimaryNav } from "./HeaderPrimaryNav";
import { ReaderHeaderBehavior } from "./ReaderHeaderBehavior";
import { HeaderUserMenu } from "./HeaderUserMenu";
import { MobileContextBackLink } from "./MobileContextBackLink";
import { ThemeToggle } from "./ThemeToggle";

function enabledByEnvironment(name: string): boolean {
  const value = process.env[name]?.trim().toLocaleLowerCase("en-US");
  return !value || ["1", "true", "yes", "on"].includes(value);
}

function configuredNoticeSeconds(value: number): number {
  const environment = process.env.NOTICE_DISPLAY_SECONDS?.trim();
  const candidate = environment ? Number(environment) : value;
  return Number.isFinite(candidate) ? Math.min(Math.max(Math.floor(candidate), 0), 60) : 5;
}

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
  searchScope = "novels",
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
  /** Original pages search articles; everything else searches the novel library. */
  searchScope?: "novels" | "originals";
}) {
  const [locale, settings, resolvedUser] = await Promise.all([
    getRequestLocale(),
    readPostgresSiteSettings(),
    currentUser === undefined ? getCurrentUser() : Promise.resolve(currentUser),
  ]);
  const siteName = await localizeText(settings.siteName || process.env.SITE_NAME || "Example Reader", locale);
  const [homeLabel, novelsLabel] = await localizeTexts(
    ["返回首页", "前往小说"] as const,
    locale,
  );
  const brandHref = settings.brandLinkTarget === "home" ? "/" : "/novels";
  const user = resolvedUser;
  const marketEnabled = settings.marketEnabled && enabledByEnvironment("MARKET_ENABLED");
  const needsNavigationState = Boolean(
    user
    && showTools
    && (unreadMessages === undefined || marketEnabled),
  );
  const needsCookieStore = showTools && ((library === undefined && Boolean(user)) || novelCatalogSearch);
  const [cookieStore, navigationState] = await Promise.all([
    needsCookieStore ? cookies() : Promise.resolve(null),
    needsNavigationState && user
      ? getUserNavigationState(user)
      : Promise.resolve(null),
  ]);
  const rememberedLibrary = library === undefined && user
    ? cookieStore?.get(novelLibraryPreferenceCookieName(user.id))?.value
    : undefined;
  const activeLibrary = library || rememberedLibrary || settings.defaultNovelLibrarySlug;
  const loginEnabled = settings.userLoginEnabled && enabledByEnvironment("USER_LOGIN_ENABLED");
  const configuredRegistrationMode = process.env.USER_REGISTRATION_MODE?.trim().toLocaleLowerCase("en-US");
  const registrationMode = !enabledByEnvironment("USER_REGISTRATION_ENABLED") || !settings.userRegistrationEnabled
    ? "closed"
    : configuredRegistrationMode === "closed" || configuredRegistrationMode === "invite" || configuredRegistrationMode === "open"
      ? configuredRegistrationMode
      : settings.userRegistrationMode;
  const registrationEnabled = registrationMode !== "closed";
  const portal = settings.homePortalAccessModes;
  const enabledMediaKinds = [
    portal.video !== "off" ? "video" : null,
    portal.audio !== "off" ? "audio" : null,
    portal.file !== "off" ? "file" : null,
  ].filter((kind): kind is "video" | "audio" | "file" => kind !== null);
  const showLibraryNav = portal.novels !== "off" && isHomePortalEntryVisible(portal.novels, Boolean(user));
  const showTagNav = portal.tags !== "off" && isHomePortalEntryVisible(portal.tags, Boolean(user));
  const showOriginalNav = settings.originalChannelEnabled && isHomePortalEntryVisible(portal.original, Boolean(user));
  const mediaKinds = user
    ? enabledMediaKinds
    : enabledMediaKinds.filter((kind) => (
      isHomePortalEntryVisible(portal[kind], false)
    ));
  const showPrimaryNav = showPrimaryNavigation && (showLibraryNav || showTagNav || showOriginalNav || mediaKinds.length > 0);
  const noticeDisplaySeconds = configuredNoticeSeconds(settings.noticeDisplaySeconds);
  const unreadCount = user ? unreadMessages ?? navigationState?.unreadMessages ?? 0 : 0;
  const showMarket = Boolean(user && marketEnabled && navigationState?.marketAccess);
  const canShowNovelSearch = showSearch && !authMode && (searchScope === "originals" ? showOriginalNav : readerMode || showLibraryNav);
  const canShowSearch = canShowNovelSearch;
  const contentSearchEnabled = activeLibrary === "all" || settings.novelSourceSearchModes[activeLibrary] !== "book";
  const resolvedSearchExpanded = novelCatalogSearch
    ? normalizeNovelCatalogSearchExpanded(
        cookieStore?.get(NOVEL_CATALOG_SEARCH_COOKIE)?.value,
        settings.novelCatalogSearchExpanded,
      )
    : defaultSearchExpanded;

  const headerClassName = [
    "siteHeader",
    "isStandardHeader",
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
            {canShowNovelSearch ? (
              <HeaderSearch
                query={query}
                defaultMode={defaultSearchMode}
                defaultExpanded={resolvedSearchExpanded}
                showCurrentSearch={showCurrentSearch}
                noticeDisplaySeconds={noticeDisplaySeconds}
                library={activeLibrary}
                contentSearchEnabled={contentSearchEnabled}
                currentSearchBookId={currentSearchBookId}
                persistCatalogPreference={novelCatalogSearch}
                scope={searchScope}
              />
            ) : null}
            <div className="headerActions">
              <ThemeToggle />
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
