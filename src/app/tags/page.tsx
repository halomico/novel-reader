import { ListFilter, Tags } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/LocalizedLink";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { SiteHeader } from "@/components/SiteHeader";
import { TagLibrarySearch } from "@/components/TagLibrarySearch";
import { TagTrackedLink } from "@/components/TagTrackedLink";
import { TagVisibilityControl } from "@/components/TagVisibilityControl";
import {
  canAccessAdvancedTagSearch,
  canAccessTagLibrary,
  isGuestTagLibraryNavEnabled,
  isTagLibraryEnabled,
  isTagLibraryPublic,
} from "@/lib/config";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { listEffectivelyHiddenTagIds, listExplicitlyHiddenTagIds } from "@/lib/tag-preferences";
import { listTagGroups } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { setTagPreferenceAction } from "./actions";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const isPublic = isTagLibraryEnabled() && isTagLibraryPublic();
  const [title, description] = await localizeTexts(
    ["所有标签", "按标签浏览小说。"] as const,
    locale,
  );
  return {
    title,
    description,
    alternates: {
      canonical: withLocalePath("/tags", locale),
      languages: languageAlternates("/tags"),
    },
    robots: isPublic ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

function visibleGroupTags(group: ReturnType<typeof listTagGroups>[number]) {
  if (group.tags.length) {
    return group.tags;
  }
  return group.group ? [group.group] : [];
}

function tagSearchText(tag: ReturnType<typeof listTagGroups>[number]["tags"][number]): string {
  return [tag.name, ...tag.aliases, tag.description].filter(Boolean).join(" ");
}

export default async function TagsPage({ searchParams }: { searchParams: Promise<{ hidden?: string }> }) {
  const locale = await getRequestLocale();
  if (!isTagLibraryEnabled()) {
    notFound();
  }
  const user = await getCurrentUser();
  if (!canAccessTagLibrary(Boolean(user))) {
    if (!user && isGuestTagLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "标签")} returnTo="/tags" />;
    }
    notFound();
  }
  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const params = await searchParams;
  const showHidden = Boolean(user && params.hidden === "1");
  const effectiveHidden = user ? listEffectivelyHiddenTagIds(user.id) : new Set<number>();
  const explicitHidden = user ? listExplicitlyHiddenTagIds(user.id) : new Set<number>();
  const sourceGroups = listTagGroups({
    audience,
    omitEmpty: !showHidden,
  }).flatMap((group) => {
    if (showHidden) {
      const groupIsHidden = Boolean(group.group && explicitHidden.has(group.group.id));
      const tags = group.tags.filter((tag) => explicitHidden.has(tag.id));
      return groupIsHidden || tags.length ? [{ ...group, tags }] : [];
    }
    if (group.group && effectiveHidden.has(group.group.id)) return [];
    const tags = group.tags.filter((tag) => !effectiveHidden.has(tag.id));
    return tags.length || (group.group && !group.tags.length) ? [{ ...group, tags }] : [];
  });
  const groups = await Promise.all(sourceGroups.map(async (group) => ({
    ...group,
    group: group.group
      ? {
          ...group.group,
          name: await localizeText(group.group.name, locale),
          aliases: await Promise.all(group.group.aliases.map((alias) => localizeText(alias, locale))),
          description: await localizeText(group.group.description, locale),
        }
      : null,
    tags: await Promise.all(group.tags.map(async (tag) => ({
      ...tag,
      name: await localizeText(tag.name, locale),
      aliases: await Promise.all(tag.aliases.map((alias) => localizeText(alias, locale))),
      description: await localizeText(tag.description, locale),
    }))),
  })));
  const showAdvancedSearch = canAccessAdvancedTagSearch(false) ||
    (canAccessAdvancedTagSearch(Boolean(user)) && hasUserPermission(user, "advanced_search"));

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: uiText(locale, "首页"), href: "/" }, { label: uiText(locale, "标签") }]} />
      <section className={`tagLibrary${showHidden ? " isManagingHidden" : ""}`}>
        <header className="tagLibraryHeader">
          <span className="tagLibraryIcon" aria-hidden="true">
            <Tags size={23} />
          </span>
          <div>
            <h1>{uiText(locale, "所有标签")}</h1>
            <p>{uiText(locale, "按分组浏览已打标签的小说。")}</p>
          </div>
          <div className="tagLibraryTools">
            <TagLibrarySearch locale={locale} />
            {showAdvancedSearch ? (
              <Link className="tagAdvancedSearchLink" href="/tags/search">
                <ListFilter size={16} aria-hidden="true" />
                {uiText(locale, "高级搜索")}
              </Link>
            ) : null}
          </div>
        </header>

        {user ? (
          <nav className="tagPreferenceTabs" aria-label={uiText(locale, "标签显示状态")}>
            <Link className={showHidden ? "" : "isActive"} href="/tags">{uiText(locale, "浏览")}</Link>
            <Link className={showHidden ? "isActive" : ""} href="/tags?hidden=1">
              {uiText(locale, "已隐藏")}
              {explicitHidden.size ? <small>{explicitHidden.size}</small> : null}
            </Link>
          </nav>
        ) : null}

        {groups.length ? (
          <div className="tagGroupStack" id="tag-library-groups">
            {groups.map((group) => {
              const tags = showHidden ? group.tags : visibleGroupTags(group);
              const groupIsExplicitlyHidden = Boolean(group.group && explicitHidden.has(group.group.id));
              return (
                <section
                  className={`tagGroupBlock${group.group && effectiveHidden.has(group.group.id) ? " isUserHidden" : ""}`}
                  data-tag-group-search={group.group ? tagSearchText(group.group) : uiText(locale, "未分组")}
                  key={group.group?.id || "ungrouped"}
                >
                  <div className="tagGroupHeader">
                    <h2>{group.group?.name || uiText(locale, "未分组")}</h2>
                    {user && group.group && (!showHidden || groupIsExplicitlyHidden) ? (
                      <form action={setTagPreferenceAction}>
                        <input name="tagId" type="hidden" value={group.group.id} />
                        <input name="hidden" type="hidden" value={groupIsExplicitlyHidden ? "0" : "1"} />
                        <input name="returnPath" type="hidden" value={showHidden ? "/tags?hidden=1" : "/tags"} />
                        <TagVisibilityControl
                          visible={!groupIsExplicitlyHidden}
                          label={groupIsExplicitlyHidden ? `显示分组 ${group.group.name}` : `隐藏分组 ${group.group.name}`}
                        />
                      </form>
                    ) : null}
                  </div>
                  {showHidden && tags.length ? (
                    <div className="tagPreferenceCloud">
                      {tags.map((tag) => (
                        <div className="tagPreferenceItem" data-tag-search={tagSearchText(tag)} key={tag.id}>
                          <TagTrackedLink className="tagChip isUserHidden" slug={tag.slug}>
                            <span>{tag.name}</span>
                            <small>{tag.directCount}</small>
                          </TagTrackedLink>
                          <form action={setTagPreferenceAction}>
                            <input name="tagId" type="hidden" value={tag.id} />
                            <input name="hidden" type="hidden" value="0" />
                            <input name="returnPath" type="hidden" value="/tags?hidden=1" />
                            <TagVisibilityControl visible={false} label={`显示标签 ${tag.name}`} />
                          </form>
                        </div>
                      ))}
                    </div>
                  ) : tags.length ? (
                    <div className="tagChipCloud">
                      {tags.map((tag) => (
                        <TagTrackedLink
                          className={`tagChip${effectiveHidden.has(tag.id) ? " isUserHidden" : ""}`}
                          slug={tag.slug}
                          data-tag-search={tagSearchText(tag)}
                          key={tag.id}
                        >
                          <span>{tag.name}</span>
                          <small>{tag.directCount}</small>
                        </TagTrackedLink>
                      ))}
                    </div>
                  ) : !groupIsExplicitlyHidden ? (
                    <p className="tagEmptyText">{uiText(locale, "暂无子标签。")}</p>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <section className="emptyState">
            <h2>{uiText(locale, showHidden ? "没有隐藏标签" : "暂无标签")}</h2>
          </section>
        )}
        {groups.length ? <p className="tagLibraryFilterEmpty" role="status" hidden>{uiText(locale, "没有匹配的标签")}</p> : null}
      </section>
    </main>
  );
}
