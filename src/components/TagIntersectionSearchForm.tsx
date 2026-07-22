"use client";

import { Check, ChevronDown, Minus, Plus, RotateCcw, Search, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { beginNavigationProgress } from "./NavigationProgress";

export type AdvancedTagGroup = {
  label: string;
  tags: Array<{
    id: number;
    name: string;
    slug: string;
    aliases: string[];
    count: number;
  }>;
};

const MAX_SELECTED_TAGS = 20;

export function TagIntersectionSearchForm({
  groups,
  initialSelected,
  initialExcluded,
  initialTitleQuery,
  initialContentQuery,
}: {
  groups: AdvancedTagGroup[];
  initialSelected: string[];
  initialExcluded: string[];
  initialTitleQuery: string;
  initialContentQuery: string;
}) {
  const router = useRouter();
  const [included, setIncluded] = useState(() => new Set(initialSelected));
  const [excluded, setExcluded] = useState(() => new Set(initialExcluded));
  const [selectionMode, setSelectionMode] = useState<"include" | "exclude">("include");
  const [titleQuery, setTitleQuery] = useState(initialTitleQuery);
  const [contentQuery, setContentQuery] = useState(initialContentQuery);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");
  const [pickerOpen, setPickerOpen] = useState(
    initialSelected.length === 0 && !initialTitleQuery.trim() && !initialContentQuery.trim(),
  );
  const [isPending, startTransition] = useTransition();
  const orderedSlugs = useMemo(() => groups.flatMap((group) => group.tags.map((tag) => tag.slug)), [groups]);
  const tagsBySlug = useMemo(() => new Map(groups.flatMap((group) => group.tags.map((tag) => [tag.slug, tag] as const))), [groups]);
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const filteredGroups = useMemo(() => groups.flatMap((group) => {
    const tags = normalizedFilter
      ? group.tags.filter((tag) => [tag.name, ...tag.aliases].join("\n").toLocaleLowerCase().includes(normalizedFilter))
      : group.tags;
    return tags.length ? [{ ...group, tags }] : [];
  }), [groups, normalizedFilter]);

  function toggleTag(slug: string) {
    setMessage("");
    if (selectionMode === "include") {
      setExcluded((current) => {
        const next = new Set(current);
        next.delete(slug);
        return next;
      });
      setIncluded((current) => {
        const next = new Set(current);
        if (next.has(slug)) next.delete(slug);
        else if (next.size < MAX_SELECTED_TAGS) next.add(slug);
        else setMessage(`最多选择 ${MAX_SELECTED_TAGS} 个包含标签`);
        return next;
      });
      return;
    }

    setIncluded((current) => {
      const next = new Set(current);
      next.delete(slug);
      return next;
    });
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < MAX_SELECTED_TAGS) next.add(slug);
      else setMessage(`最多选择 ${MAX_SELECTED_TAGS} 个排除标签`);
      return next;
    });
  }

  function removeTag(slug: string) {
    setIncluded((current) => {
      const next = new Set(current);
      next.delete(slug);
      return next;
    });
    setExcluded((current) => {
      const next = new Set(current);
      next.delete(slug);
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const includedTags = orderedSlugs.filter((slug) => included.has(slug));
    const excludedTags = orderedSlugs.filter((slug) => excluded.has(slug));
    const normalizedTitle = titleQuery.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const normalizedContent = contentQuery.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!includedTags.length && !normalizedTitle && !normalizedContent) {
      setMessage("请选择标签或输入标题、正文关键词");
      return;
    }
    const params = new URLSearchParams();
    if (includedTags.length) params.set("tags", includedTags.join(","));
    if (excludedTags.length) params.set("exclude", excludedTags.join(","));
    if (normalizedTitle) params.set("q", normalizedTitle);
    if (normalizedContent) params.set("content", normalizedContent);
    setPickerOpen(false);
    beginNavigationProgress();
    startTransition(() => router.push(`/tags/search?${params.toString()}#advanced-search-results`));
  }

  return (
    <form className="advancedTagSearchForm" onSubmit={submit}>
      <div className="advancedTagSearchToolbar">
        <label>
          <span>标题关键词</span>
          <input value={titleQuery} onChange={(event) => { setTitleQuery(event.target.value); setMessage(""); }} maxLength={80} placeholder="可选" />
        </label>
        <label>
          <span>正文关键词</span>
          <input value={contentQuery} onChange={(event) => { setContentQuery(event.target.value); setMessage(""); }} maxLength={200} placeholder="可选，多关键词用空格分隔" />
        </label>
        <div className="advancedTagSearchActions">
          <button
            className="iconButton"
            type="button"
            disabled={!included.size && !excluded.size}
            onClick={() => {
              setIncluded(new Set());
              setExcluded(new Set());
              setMessage("");
            }}
            aria-label="清除已选标签"
            title="清除已选"
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
          <button className="iconTextButton" type="submit" disabled={isPending}>
            <Search size={16} aria-hidden="true" />
            搜索
          </button>
        </div>
      </div>

      {message ? <strong className="advancedTagMessage" role="status">{message}</strong> : null}

      {included.size || excluded.size ? (
        <div className="advancedTagConditionSummary" aria-label="已选标签条件">
          {Array.from(included).map((slug) => {
            const tag = tagsBySlug.get(slug);
            return tag ? (
              <button className="isIncluded" type="button" onClick={() => removeTag(slug)} title={`移除包含标签 ${tag.name}`} key={`include-${slug}`}>
                <Plus size={12} aria-hidden="true" />{tag.name}
              </button>
            ) : null;
          })}
          {Array.from(excluded).map((slug) => {
            const tag = tagsBySlug.get(slug);
            return tag ? (
              <button className="isExcluded" type="button" onClick={() => removeTag(slug)} title={`移除排除标签 ${tag.name}`} key={`exclude-${slug}`}>
                <Minus size={12} aria-hidden="true" />{tag.name}
              </button>
            ) : null;
          })}
        </div>
      ) : null}

      <details className="advancedTagPicker" open={pickerOpen} onToggle={(event) => setPickerOpen(event.currentTarget.open)}>
        <summary>
          <span><Tags size={16} aria-hidden="true" />标签</span>
          <small>{included.size + excluded.size || groups.reduce((count, group) => count + group.tags.length, 0)}</small>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="advancedTagPickerBody">
          <div className="advancedTagSelectionStatus" aria-live="polite">
            <div className="advancedTagSelectionMode" role="group" aria-label="标签条件">
              <button className={selectionMode === "include" ? "isActive" : ""} type="button" onClick={() => setSelectionMode("include")} aria-pressed={selectionMode === "include"}>
                <Plus size={14} aria-hidden="true" />包含 {included.size}
              </button>
              <button className={selectionMode === "exclude" ? "isActive" : ""} type="button" onClick={() => setSelectionMode("exclude")} aria-pressed={selectionMode === "exclude"}>
                <Minus size={14} aria-hidden="true" />排除 {excluded.size}
              </button>
            </div>
            <label className="advancedTagFilter">
              <Search size={14} aria-hidden="true" />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选标签或别名" aria-label="筛选标签或别名" />
            </label>
          </div>
          <div className="advancedTagGroups">
            {filteredGroups.length ? filteredGroups.map((group) => (
              <section className="advancedTagGroup" key={group.label}>
                <h2>{group.label}</h2>
                <div className="advancedTagOptions">
                  {group.tags.map((tag) => {
                    const isIncluded = included.has(tag.slug);
                    const isExcluded = excluded.has(tag.slug);
                    return (
                      <button
                        className={`advancedTagOption${isIncluded ? " isSelected" : ""}${isExcluded ? " isExcluded" : ""}`}
                        type="button"
                        onClick={() => toggleTag(tag.slug)}
                        aria-pressed={isIncluded || isExcluded}
                        key={tag.id}
                      >
                        {isIncluded ? <Check size={13} aria-hidden="true" /> : isExcluded ? <Minus size={13} aria-hidden="true" /> : <span aria-hidden="true" />}
                        <span>{tag.name}</span>
                        <small>{tag.count}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
            )) : <p className="advancedTagEmpty">没有匹配的标签</p>}
          </div>
        </div>
      </details>
    </form>
  );
}
