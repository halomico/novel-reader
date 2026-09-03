import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { SiteHeader } from "@/components/SiteHeader";
import { TagLibraryManager, type ManagedTag } from "@/components/TagLibraryManager";
import {
  canAccessAdvancedTagSearch,
  canAccessTagLibrary,
  isGuestTagLibraryNavEnabled,
  isTagLibraryEnabled,
  isTagLibraryPublic,
} from "@/lib/config";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { listExplicitlyHiddenTagIds } from "@/lib/tag-preferences";
import { listTagGroups } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
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

function tagSearchText(tag: ReturnType<typeof listTagGroups>[number]["tags"][number]): string {
  return [tag.name, ...tag.aliases, tag.description].filter(Boolean).join(" ");
}

function managedTag(tag: ReturnType<typeof listTagGroups>[number]["tags"][number]): ManagedTag {
  return {
    id: tag.id,
    parentId: tag.parentId,
    name: tag.name,
    slug: tag.slug,
    directCount: tag.directCount,
    searchText: tagSearchText(tag),
  };
}

export default async function TagsPage({ searchParams }: { searchParams: Promise<{ hidden?: string; q?: string }> }) {
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
  const initialQuery = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const explicitHidden = user ? listExplicitlyHiddenTagIds(user.id) : new Set<number>();
  const sourceGroups = listTagGroups({ audience, omitEmpty: false });
  const localizedGroups = await Promise.all(sourceGroups.map(async (group) => ({
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
      <TagLibraryManager
        locale={locale}
        groups={localizedGroups.map((group) => ({
          group: group.group ? managedTag(group.group) : null,
          tags: group.tags.map(managedTag),
        }))}
        initialHiddenIds={[...explicitHidden]}
        initialQuery={initialQuery}
        showAdvancedSearch={showAdvancedSearch}
        signedIn={Boolean(user)}
      />
    </main>
  );
}
