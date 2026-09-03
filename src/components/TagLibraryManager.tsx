"use client";

import { Check, Filter, Search, Settings2, X } from "lucide-react";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import { replaceTagPreferencesAction } from "@/app/tags/actions";
import Link from "@/components/LocalizedLink";
import { PageContextBar } from "@/components/PageContextBar";
import { TagTrackedLink } from "@/components/TagTrackedLink";
import { type AppLocale, uiText } from "@/lib/locale";

export type ManagedTag = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  directCount: number;
  searchText: string;
};

export type ManagedTagGroup = {
  group: ManagedTag | null;
  tags: ManagedTag[];
};

function normalizedTerms(value: string): string[] {
  return value.normalize("NFKC").toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

function matchesTerms(value: string, terms: string[]): boolean {
  const haystack = value.normalize("NFKC").toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function syncQueryUrl(value: string) {
  const url = new URL(window.location.href);
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized) url.searchParams.set("q", normalized);
  else url.searchParams.delete("q");
  url.searchParams.delete("hidden");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function TagLibraryManager({
  locale,
  groups,
  initialHiddenIds,
  initialQuery,
  showAdvancedSearch,
  signedIn,
}: {
  locale: AppLocale;
  groups: ManagedTagGroup[];
  initialHiddenIds: number[];
  initialQuery: string;
  showAdvancedSearch: boolean;
  signedIn: boolean;
}) {
  const tr = (text: string) => uiText(locale, text);
  const [query, setQuery] = useState(initialQuery);
  const [managing, setManaging] = useState(false);
  const [hiddenIds, setHiddenIds] = useState(() => new Set(initialHiddenIds));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const parentById = useMemo(() => new Map(
    groups.flatMap((item) => [item.group, ...item.tags])
      .filter((tag): tag is ManagedTag => Boolean(tag))
      .map((tag) => [tag.id, tag.parentId]),
  ), [groups]);
  const effectiveHiddenIds = useMemo(() => {
    const result = new Set<number>();
    for (const tagId of parentById.keys()) {
      let current: number | null | undefined = tagId;
      while (current) {
        if (hiddenIds.has(current)) {
          result.add(tagId);
          break;
        }
        current = parentById.get(current);
      }
    }
    return result;
  }, [hiddenIds, parentById]);
  const terms = useMemo(() => normalizedTerms(query), [query]);

  function toggleTag(tagId: number) {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
    setError("");
  }

  function finishManaging() {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await replaceTagPreferencesAction([...hiddenIds]);
        if (!result.ok) {
          setError(tr("保存失败，请重试"));
          return;
        }
        setHiddenIds(new Set(result.hiddenIds));
        setManaging(false);
      } catch {
        setError(tr("保存失败，请重试"));
      }
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    syncQueryUrl(query);
  }

  const renderedGroups = groups.flatMap((item) => {
    const groupMatches = Boolean(item.group && terms.length && matchesTerms(item.group.searchText, terms));
    const tags = item.tags.filter((tag) => {
      const available = tag.directCount > 0 || effectiveHiddenIds.has(tag.id);
      return available && (terms.length === 0 || groupMatches || matchesTerms(tag.searchText, terms));
    });
    const groupHidden = Boolean(item.group && effectiveHiddenIds.has(item.group.id));
    const visibleTags = managing ? tags : tags.filter((tag) => !effectiveHiddenIds.has(tag.id));
    const keepHiddenGroup = Boolean(managing && item.group && hiddenIds.has(item.group.id));
    const keepStandalone = Boolean(
      item.group &&
      item.tags.length === 0 &&
      (item.group.directCount > 0 || groupHidden) &&
      (terms.length === 0 || groupMatches) &&
      (managing || !groupHidden),
    );
    return visibleTags.length || keepHiddenGroup || keepStandalone ? [{ ...item, tags: visibleTags, groupHidden }] : [];
  });

  const standaloneTags = renderedGroups.flatMap((item) => item.group && item.tags.length === 0 ? [item.group] : []);
  const groupedTags = renderedGroups.filter((item) => !item.group || item.tags.length > 0);
  const hasResults = standaloneTags.length > 0 || groupedTags.length > 0;

  function renderTag(tag: ManagedTag, inherited = false) {
    if (managing) {
      const explicitlyHidden = hiddenIds.has(tag.id);
      return (
        <button
          className={`tagChip tagManageChoice${explicitlyHidden ? " isUserHidden isSelected" : inherited ? " isInherited" : ""}`}
          type="button"
          aria-pressed={explicitlyHidden}
          aria-label={`${explicitlyHidden ? tr("显示标签") : tr("隐藏标签")} ${tag.name}`}
          title={inherited ? tr("该标签由分组隐藏") : undefined}
          disabled={inherited}
          onClick={() => toggleTag(tag.id)}
          key={tag.id}
        >
          <span>{tag.name}</span>
          <small>{tag.directCount}</small>
        </button>
      );
    }
    return (
      <TagTrackedLink className="tagChip contentTagLink" slug={tag.slug} key={tag.id}>
        <span>{tag.name}</span>
        <small>{tag.directCount}</small>
      </TagTrackedLink>
    );
  }

  return (
    <>
      <PageContextBar items={[{ label: tr("首页"), href: "/" }, { label: tr("标签") }]} search={(
        <div className="tagLibraryTools">
          <div className="tagLibraryControls">
            {signedIn ? (
              <button
                className={`catalogMenuTrigger tagManageButton${managing ? " isActive" : ""}`}
                type="button"
                disabled={pending}
                aria-label={managing ? tr("完成标签管理") : tr("管理标签")}
                title={managing ? (pending ? tr("保存中") : tr("完成")) : tr("管理标签")}
                onClick={() => managing ? finishManaging() : setManaging(true)}
              >
                {managing ? <Check size={16} aria-hidden="true" /> : <Settings2 size={16} aria-hidden="true" />}
              </button>
            ) : null}
            {showAdvancedSearch ? (
              <Link
                className="catalogMenuTrigger tagAdvancedSearchLink"
                href="/tags/search"
                aria-label={tr("高级搜索")}
                title={tr("高级搜索")}
              >
                <Filter size={16} aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          <form className="tagLibrarySearch" role="search" onSubmit={submitSearch}>
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr("搜索标签")}
              aria-label={tr("搜索标签")}
              aria-controls="tag-library"
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <button type="button" onClick={() => { setQuery(""); syncQueryUrl(""); }} aria-label={tr("清空搜索")} title={tr("清空")}>
                <X size={15} aria-hidden="true" />
              </button>
            ) : <span aria-hidden="true" />}
          </form>
        </div>
      )} />
      <section id="tag-library" className={`tagLibrary${managing ? " isManagingHidden" : ""}`}>
        {error ? <p className="tagManageError" role="alert">{error}</p> : null}
        {hasResults ? (
          <div className="tagGroupStack" id="tag-library-groups">
            {standaloneTags.length ? (
              <section className="tagGroupBlock tagStandaloneGroup">
                <div className="tagGroupHeader"><h2>{tr("标签")}</h2></div>
                <div className="tagChipCloud">{standaloneTags.map((tag) => renderTag(tag))}</div>
              </section>
            ) : null}
            {groupedTags.map((item) => {
              const groupExplicitlyHidden = Boolean(item.group && hiddenIds.has(item.group.id));
              return (
                <section className={`tagGroupBlock${item.groupHidden ? " isUserHidden" : ""}`} key={item.group?.id || "ungrouped"}>
                  <div className="tagGroupHeader">
                    {managing && item.group ? (
                      <button
                        className={`tagGroupManageButton${groupExplicitlyHidden ? " isSelected" : ""}`}
                        type="button"
                        aria-pressed={groupExplicitlyHidden}
                        onClick={() => toggleTag(item.group!.id)}
                      >
                        <span>{item.group.name}</span>
                        {groupExplicitlyHidden ? <Check size={15} aria-hidden="true" /> : null}
                      </button>
                    ) : <h2>{item.group?.name || tr("未分组")}</h2>}
                  </div>
                  <div className="tagChipCloud">
                    {item.tags.map((tag) => renderTag(tag, Boolean(item.groupHidden && !hiddenIds.has(tag.id))))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <section className="emptyState"><h2>{query ? tr("没有匹配的标签") : tr("暂无标签")}</h2></section>
        )}
      </section>
    </>
  );
}
