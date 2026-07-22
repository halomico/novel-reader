import { ListFilter, Tags } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import { TagTrackedLink } from "@/components/TagTrackedLink";
import { getAdminSession } from "@/lib/admin-auth";
import { canAccessAdvancedTagSearch, isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { listTagGroups } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

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

export default async function TagsPage() {
  if (!isTagLibraryEnabled()) {
    notFound();
  }
  const [user, adminSession] = await Promise.all([getCurrentUser(), getAdminSession()]);
  if (!user && !adminSession && !isGuestTagLibraryNavEnabled()) {
    return <TagsLocked />;
  }
  const groups = listTagGroups();

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
          {adminSession || canAccessAdvancedTagSearch(Boolean(user)) ? (
            <Link className="tagAdvancedSearchLink" href="/tags/search">
              <ListFilter size={16} aria-hidden="true" />
              高级搜索
            </Link>
          ) : null}
        </header>

        {groups.length ? (
          <div className="tagGroupStack">
            {groups.map((group) => {
              const tags = visibleGroupTags(group);
              return (
                <section className="tagGroupBlock" key={group.group?.id || "ungrouped"}>
                  <div className="tagGroupHeader">
                    <h2>{group.group?.name || "未分组"}</h2>
                  </div>
                  {tags.length ? (
                    <div className="tagChipCloud">
                      {tags.map((tag) => (
                        <TagTrackedLink className="tagChip" slug={tag.slug} key={tag.id}>
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
