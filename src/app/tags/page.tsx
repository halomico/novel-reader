import type { Metadata } from "next";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import {
  listPostgresCatalogTagGroups,
  listPostgresExplicitlyHiddenTagIds,
  type PostgresCatalogTag,
} from "@/domains/catalog/postgres-tags";
import { hasPostgresUserPermission } from "@/domains/identity/postgres-permissions";
import { notFound } from "next/navigation";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { SiteHeader } from "@/components/SiteHeader";
import { TagLibraryManager, type ManagedTag } from "@/components/TagLibraryManager";
import { isGuestTagLibraryNavEnabled } from "@/lib/config";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [locale, settings] = await Promise.all([getRequestLocale(), readPostgresSiteSettings()]);
  const isPublic = canBrowseHomePortal(settings.homePortalAccessModes.tags, false);
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

function tagSearchText(tag: PostgresCatalogTag): string {
  return [tag.name, ...tag.aliases, tag.description].filter(Boolean).join(" ");
}

function managedTag(tag: PostgresCatalogTag): ManagedTag {
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
  const [locale, settings, user, params] = await Promise.all([
    getRequestLocale(),
    readPostgresSiteSettings(),
    getCurrentUser(),
    searchParams,
  ]);
  if (settings.homePortalAccessModes.tags === "off") {
    notFound();
  }
  if (!canBrowseHomePortal(settings.homePortalAccessModes.tags, Boolean(user))) {
    if (!user && isGuestTagLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "标签")} returnTo="/tags" />;
    }
    notFound();
  }
  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const initialQuery = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const [explicitHidden, sourceGroups] = await Promise.all([
    user ? listPostgresExplicitlyHiddenTagIds(database("web"), user.id) : Promise.resolve(new Set<number>()),
    listPostgresCatalogTagGroups(database("web"), { audience, omitEmpty: false }),
  ]);
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
  const guestAdvancedSearch = settings.advancedTagSearchEnabled && settings.guestAdvancedTagSearchEnabled &&
    canBrowseHomePortal(settings.homePortalAccessModes.novels, false) &&
    canBrowseHomePortal(settings.homePortalAccessModes.tags, false);
  const memberAdvancedSearch = settings.advancedTagSearchEnabled &&
    canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user)) &&
    canBrowseHomePortal(settings.homePortalAccessModes.tags, Boolean(user));
  const showAdvancedSearch = guestAdvancedSearch ||
    (memberAdvancedSearch && await hasPostgresUserPermission(database("web"), user, "advanced_search"));

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
