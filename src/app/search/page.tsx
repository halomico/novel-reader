import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { PageContextBar } from "@/components/PageContextBar";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { resolvePostgresNovelLibraryScope } from "@/domains/catalog/postgres-catalog";
import {
  normalizePostgresSearchQuerySource,
  recordPostgresSearchQuery,
  resolvePostgresSearchEventKey,
} from "@/domains/analytics/postgres-search-analytics";
import { validateSearchKeyword } from "@/lib/search-query";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { getRequestLocale, localizeTexts } from "@/lib/locale-server";
import { canBrowseHomePortal, isHomePortalEntryVisible } from "@/lib/home-portal";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { DEFAULT_NOVEL_LIBRARY_SLUG } from "@/lib/novel-library-scope";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: uiText(locale, "全文搜索"),
    robots: NO_INDEX_ROBOTS,
    alternates: {
      canonical: withLocalePath("/search", locale),
      languages: languageAlternates("/search"),
    },
  };
}

type SearchPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    source?: string;
    origin?: string;
    searchEvent?: string;
    library?: string;
    sourceLibrary?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const [locale, user, params, settings] = await Promise.all([
    getRequestLocale(),
    getCurrentUser(),
    searchParams,
    readPostgresSiteSettings(),
  ]);
  const novelAccessMode = settings.homePortalAccessModes.novels;
  if (!canBrowseHomePortal(novelAccessMode, Boolean(user))) {
    if (!user && isHomePortalEntryVisible(novelAccessMode, false)) {
      const gateParams = new URLSearchParams();
      if (params.q) gateParams.set("q", params.q);
      if (params.library || params.sourceLibrary) gateParams.set("library", params.library || params.sourceLibrary || "");
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "全文搜索")} returnTo={`/search${gateParams.size ? `?${gateParams.toString()}` : ""}`} />;
    }
    notFound();
  }
  const access = await checkPostgresContentAccess(database("web"), await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const originalQuery = params.q || "";
  const libraryScope = await resolvePostgresNovelLibraryScope(
    database("web"),
    params.library || params.sourceLibrary,
    settings.defaultNovelLibrarySlug,
  );
  const fullTextSearchEnabled = libraryScope.kind === "all" || settings.novelSourceSearchModes[libraryScope.source.slug] !== "book";
  const validation = validateSearchKeyword(originalQuery);
  const source = normalizePostgresSearchQuerySource(params.source);
  const originNovelId = Number(params.origin || 0);
  let searchEventKey = validation.ok && settings.analyticsEnabled
    ? await resolvePostgresSearchEventKey(database("web"), params.searchEvent, validation.keyword)
    : null;
  if (validation.ok && settings.analyticsEnabled && !searchEventKey) {
    searchEventKey = await recordPostgresSearchQuery(database("web"), originalQuery, "content", {
      source,
      userId: user?.id ?? null,
      originNovelId,
    });
  }
  const pageValue = Number(params.page || 1);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;
  const [homeLabel, searchLabel] = await localizeTexts(
    ["首页", "全文搜索"] as const,
    locale,
  );

  return (
    <main className="appShell">
      <SiteHeader showSearch query={originalQuery} defaultSearchMode="content" currentUser={user} library={libraryScope.slug} />
      <PageContextBar items={[{ label: homeLabel, href: "/" }, { label: searchLabel }]} />
      {!fullTextSearchEnabled ? (
        <section className="searchHero">
          <p className="searchMessage">{uiText(locale, "该书库未加入全站正文索引，请进入具体书籍后使用“本书”搜索。")}</p>
        </section>
      ) : validation.ok ? (
        <ContentSearchClient
          key={`${libraryScope.slug}:${originalQuery}`}
          keyword={originalQuery}
          initialPage={page}
          highlightTerms={validation.query.highlightTerms}
          searchEventKey={searchEventKey}
          searchSource={source}
          originNovelId={Number.isInteger(originNovelId) && originNovelId > 0 ? originNovelId : null}
          library={libraryScope.slug}
          resultReturnParams={libraryScope.slug === DEFAULT_NOVEL_LIBRARY_SLUG ? {} : { library: libraryScope.slug }}
        />
      ) : (
        <section className="searchHero">
          <p className="searchMessage">{validation.message}</p>
        </section>
      )}
    </main>
  );
}
