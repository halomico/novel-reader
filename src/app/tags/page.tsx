import { Eye, EyeOff, ListFilter, Tags } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import { TagTrackedLink } from "@/components/TagTrackedLink";
import { canAccessAdvancedTagSearch, isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { listEffectivelyHiddenTagIds, listExplicitlyHiddenTagIds } from "@/lib/tag-preferences";
import { listTagGroups } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { setTagPreferenceAction } from "./actions";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const isPublic = isTagLibraryEnabled() && isGuestTagLibraryNavEnabled();
  return {
    title: "所有标签",
    description: "按标签浏览小说。",
    alternates: { canonical: "/tags" },
    robots: isPublic ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

function visibleGroupTags(group: ReturnType<typeof listTagGroups>[number]) {
  if (group.tags.length) {
    return group.tags;
  }
  return group.group ? [group.group] : [];
}

function TagsLocked() {
  return (
    <main className="appShell">
      <SiteHeader currentUser={null} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "标签" }]} />
      <section className="emptyState">
        <h2>登录后可查看标签</h2>
      </section>
    </main>
  );
}

export default async function TagsPage({ searchParams }: { searchParams: Promise<{ hidden?: string }> }) {
  if (!isTagLibraryEnabled()) {
    notFound();
  }
  const user = await getCurrentUser();
  if (!user && !isGuestTagLibraryNavEnabled()) {
    return <TagsLocked />;
  }
  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const params = await searchParams;
  const showHidden = Boolean(user && params.hidden === "1");
  const effectiveHidden = user ? listEffectivelyHiddenTagIds(user.id) : new Set<number>();
  const explicitHidden = user ? listExplicitlyHiddenTagIds(user.id) : new Set<number>();
  const groups = listTagGroups({ audience }).flatMap((group) => {
    if (!showHidden && group.group && effectiveHidden.has(group.group.id)) return [];
    const tags = showHidden ? group.tags : group.tags.filter((tag) => !effectiveHidden.has(tag.id));
    return tags.length || (group.group && !group.tags.length) ? [{ ...group, tags }] : [];
  });
  const showAdvancedSearch = canAccessAdvancedTagSearch(false) ||
    (canAccessAdvancedTagSearch(Boolean(user)) && hasUserPermission(user, "advanced_search"));

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "标签" }]} />
      <section className="tagLibrary">
        <header className="tagLibraryHeader">
          <span className="tagLibraryIcon" aria-hidden="true">
            <Tags size={23} />
          </span>
          <div>
            <h1>所有标签</h1>
            <p>按分组浏览已打标签的小说。</p>
          </div>
          {showAdvancedSearch ? (
            <Link className="tagAdvancedSearchLink" href="/tags/search">
              <ListFilter size={16} aria-hidden="true" />
              高级搜索
            </Link>
          ) : null}
          {user ? (
            <Link className="tagHiddenToggle" href={showHidden ? "/tags" : "/tags?hidden=1"} title={showHidden ? "返回可见标签" : "查看已隐藏标签"}>
              {showHidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
              <span>{showHidden ? "可见标签" : "已隐藏"}</span>
            </Link>
          ) : null}
        </header>

        {groups.length ? (
          <div className="tagGroupStack">
            {groups.map((group) => {
              const tags = visibleGroupTags(group);
              return (
                <section className={`tagGroupBlock${group.group && effectiveHidden.has(group.group.id) ? " isUserHidden" : ""}`} key={group.group?.id || "ungrouped"}>
                  <div className="tagGroupHeader">
                    <h2>{group.group?.name || "未分组"}</h2>
                    {user && group.group ? (
                      <form action={setTagPreferenceAction}>
                        <input name="tagId" type="hidden" value={group.group.id} />
                        <input name="hidden" type="hidden" value={explicitHidden.has(group.group.id) ? "0" : "1"} />
                        <input name="returnPath" type="hidden" value={showHidden ? "/tags?hidden=1" : "/tags"} />
                        <button
                          type="submit"
                          aria-label={explicitHidden.has(group.group.id) ? `恢复 ${group.group.name}` : `隐藏 ${group.group.name}`}
                          title={explicitHidden.has(group.group.id) ? "恢复分组" : "隐藏分组"}
                        >
                          {explicitHidden.has(group.group.id)
                            ? <Eye size={15} aria-hidden="true" />
                            : <EyeOff size={15} aria-hidden="true" />}
                        </button>
                      </form>
                    ) : null}
                  </div>
                  {tags.length ? (
                    <div className="tagChipCloud">
                      {tags.map((tag) => (
                        <TagTrackedLink className={`tagChip${effectiveHidden.has(tag.id) ? " isUserHidden" : ""}`} slug={tag.slug} key={tag.id}>
                          <span>{tag.name}</span>
                          <small>{tag.directCount}</small>
                        </TagTrackedLink>
                      ))}
                    </div>
                  ) : (
                    <p className="tagEmptyText">暂无子标签。</p>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <section className="emptyState">
            <h2>暂无标签</h2>
          </section>
        )}
      </section>
    </main>
  );
}
