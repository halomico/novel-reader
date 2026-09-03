import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/LocalizedLink";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { PageContextBar } from "@/components/PageContextBar";
import { SiteHeader } from "@/components/SiteHeader";
import { TagLibrarySearch } from "@/components/TagLibrarySearch";
import { canAccessOriginalChannel, isOriginalChannelEnabled, isOriginalChannelEntryVisible } from "@/lib/config";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { uiText } from "@/lib/locale";
import { getCurrentUser } from "@/lib/user-auth";
import { listOriginalTagSummaries } from "@/lib/original";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: uiText(locale, "标签"), description: uiText(locale, "按标签浏览原创文章。") };
}

export default async function OriginalTagsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  if (!isOriginalChannelEnabled()) notFound();
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const user = await getCurrentUser();
  if (!canAccessOriginalChannel(Boolean(user))) {
    if (!user && isOriginalChannelEntryVisible(false)) {
      return <ContentEntryGatePage locale={locale} label={tr("原创")} returnTo="/original/tags" />;
    }
    notFound();
  }
  const params = await searchParams;
  const query = String(params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const tags = listOriginalTagSummaries();
  const displayTags = await Promise.all(tags.map(async (tag) => ({
    ...tag,
    name: await localizeText(tag.name, locale),
  })));

  return (
    <main className="appShell originalShell originalTagsShell">
      <SiteHeader currentUser={user} />
      <PageContextBar
        items={[{ label: tr("首页"), href: "/" }, { label: tr("原创"), href: "/original" }, { label: tr("标签") }]}
        search={<TagLibrarySearch locale={locale} initialQuery={query} targetId="original-tag-library" />}
      />
      <section id="original-tag-library" className="originalTagDirectory">
        {displayTags.length ? (
          <>
            <div className="tagChipCloud originalTagDirectoryCloud" data-tag-group-search={tr("标签")}>
              {displayTags.map((tag) => (
                <Link
                  className="tagChip contentTagLink"
                  href={`/original/tags/${encodeURIComponent(tag.slug)}`}
                  data-tag-search={`${tag.name} ${tag.slug}`}
                  key={tag.id}
                >
                  <span>{tag.name}</span>
                  <small>{tag.articleCount}</small>
                </Link>
              ))}
            </div>
            <p className="tagLibraryFilterEmpty" hidden>{tr("没有找到匹配的标签。")}</p>
          </>
        ) : (
          <p className="originalEmpty">{tr("没有找到匹配的标签。")}</p>
        )}
      </section>
    </main>
  );
}
