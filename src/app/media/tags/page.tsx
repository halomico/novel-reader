import { Search, X } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import Link from "@/components/LocalizedLink";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { checkContentAccess } from "@/lib/content-access";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText, normalizeSearchText } from "@/lib/locale-server";
import { isMediaKindAccessible, isMediaKindEntryVisible, isMediaKindPublic, listVideoTags } from "@/lib/media";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type VideoTagsPageProps = {
  searchParams: Promise<{ q?: string; page?: string }>;
};

export async function generateMetadata({ searchParams }: VideoTagsPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const canonicalParams = new URLSearchParams();
  const page = Number(params.page || 1);
  if (Number.isInteger(page) && page > 1) canonicalParams.set("page", String(page));
  const canonicalPath = `/media/tags${canonicalParams.size ? `?${canonicalParams.toString()}` : ""}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const title = uiText(locale, "视频标签");
  const description = uiText(locale, "按标签浏览站内视频。");
  return {
    title,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    robots: isMediaKindPublic("video") && !params.q?.trim() ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title, description, url: canonical },
  };
}

export default async function VideoTagsPage({ searchParams }: VideoTagsPageProps) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const headerStore = await headers();
  if (!isMediaKindAccessible("video", Boolean(user))) {
    if (!user && isMediaKindEntryVisible("video", false)) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "视频标签")} returnTo="/media/tags" />;
    }
    notFound();
  }
  if (!checkContentAccess(headerStore, {
    scope: "video",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  }).allowed) notFound();

  const params = await searchParams;
  const queryInput = String(params.q || "").trim().slice(0, 80);
  const result = listVideoTags({
    query: queryInput ? await normalizeSearchText(queryInput) : "",
    page: Number(params.page || 1),
    pageSize: 96,
  });
  const tags = await Promise.all(result.tags.map(async (tag) => ({
    ...tag,
    name: await localizeText(tag.name, locale),
  })));

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[
        { label: uiText(locale, "首页"), href: "/" },
        { label: uiText(locale, "视频"), href: "/media?kind=video" },
        { label: uiText(locale, "标签") },
      ]} />
      <section className="mediaTagDirectory">
        <header className="mediaLibraryHeader mediaTagDirectoryHeader">
          <div className="mediaLibraryHeading">
            <h1>{uiText(locale, "视频标签")}</h1>
            <span className="resultCount">
              <span>{uiText(locale, "共")}</span>
              <strong>{result.totalTags.toLocaleString(locale === "zh-Hant" ? "zh-Hant" : "zh-CN")}</strong>
              <span>{uiText(locale, "个")}</span>
            </span>
          </div>
          <Form className="mediaSearchForm mediaTagSearch" action="/media/tags">
            <input name="q" defaultValue={queryInput} placeholder={uiText(locale, "搜索标签")} aria-label={uiText(locale, "搜索标签")} />
            {queryInput ? (
              <Link className="mediaSearchIconButton" href="/media/tags" aria-label={uiText(locale, "清除搜索")} title={uiText(locale, "清除搜索")}>
                <X size={15} aria-hidden="true" />
              </Link>
            ) : null}
            <button className="mediaSearchIconButton" type="submit" aria-label={uiText(locale, "搜索标签")} title={uiText(locale, "搜索标签")}>
              <Search size={16} aria-hidden="true" />
            </button>
          </Form>
        </header>

        {tags.length ? (
          <div className="mediaTagGrid">
            {tags.map((tag) => (
              <Link className="mediaTagItem" href={`/media?${new URLSearchParams({ kind: "video", tag: tag.slug }).toString()}`} key={tag.id}>
                <strong>#{tag.name}</strong>
                <span>{tag.videoCount.toLocaleString("zh-CN")}</span>
              </Link>
            ))}
          </div>
        ) : <div className="mediaEmptyState"><p>{uiText(locale, "没有找到匹配的标签。")}</p></div>}

        <Pagination page={result.page} totalPages={result.totalPages} query={queryInput} basePath="/media/tags" />
      </section>
    </main>
  );
}
