"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import Form from "next/form";
import Link from "@/components/LocalizedLink";
import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { localeFromPathname, stripLocalePath, uiText, withLocalePath } from "@/lib/locale";
import { beginNavigationProgress } from "./NavigationProgress";

type SearchMode = "title" | "content" | "current";
type MessageTone = "success" | "warning" | "error";
type SearchVisibility = "default" | "open" | "closed";
type CurrentMatch = {
  segment: HTMLElement;
  start: number;
  end: number;
};

const options: Array<{ value: SearchMode; label: string; action: string; placeholder: string; ariaLabel?: string }> = [
  { value: "title", label: "标题", action: "/novels", placeholder: "搜索小说名" },
  {
    value: "content",
    label: "正文",
    action: "/search",
    placeholder: "多个关键词用空格分隔",
    ariaLabel: "搜索全部小说正文，多个关键词用空格分隔",
  },
  { value: "current", label: "本文", action: "/search", placeholder: "搜索本文" },
];

const originalTextBySegment = new WeakMap<HTMLElement, string>();

function getReaderSegments(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".readerSegment"));
}

function getOriginalSegmentText(segment: HTMLElement): string {
  const originalText = originalTextBySegment.get(segment);
  if (originalText !== undefined) {
    return originalText;
  }

  const text = segment.textContent || "";
  originalTextBySegment.set(segment, text);
  return text;
}

function restoreSegment(segment: HTMLElement) {
  const originalText = originalTextBySegment.get(segment);
  if (originalText === undefined) {
    return;
  }

  segment.replaceChildren(document.createTextNode(originalText));
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function findLiteralMatches(segments: HTMLElement[], keyword: string, isCurrent: () => boolean): Promise<CurrentMatch[]> {
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escapedKeyword, "giu");
  const matches: CurrentMatch[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    if (!isCurrent()) {
      return [];
    }
    const segment = segments[index];
    const text = getOriginalSegmentText(segment);
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) {
        continue;
      }
      matches.push({
        segment,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    if (index > 0 && index % 40 === 0) {
      await yieldToMainThread();
    }
  }

  return matches;
}

export function HeaderSearch({
  query = "",
  defaultMode = "title",
  defaultExpanded = false,
  showCurrentSearch = false,
  showAdvancedSearch = false,
  noticeDisplaySeconds = 5,
  library = "default",
  contentSearchEnabled = true,
  currentSearchBookId,
}: {
  query?: string;
  defaultMode?: SearchMode;
  defaultExpanded?: boolean;
  showCurrentSearch?: boolean;
  showAdvancedSearch?: boolean;
  noticeDisplaySeconds?: number;
  library?: string;
  contentSearchEnabled?: boolean;
  currentSearchBookId?: number;
}) {
  const pathname = usePathname();
  const normalizedPathname = stripLocalePath(pathname);
  const locale = localeFromPathname(pathname);
  const tr = (text: string) => uiText(locale, text);
  const [mode, setMode] = useState<SearchMode>(defaultMode);
  const [keyword, setKeyword] = useState(query);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [visibility, setVisibility] = useState<SearchVisibility>(() => (
    query.trim() ? "open" : defaultExpanded ? "default" : "closed"
  ));
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("success");
  const [isMessageVisible, setIsMessageVisible] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [currentMatchCount, setCurrentMatchCount] = useState(0);
  const [isCurrentSearching, setIsCurrentSearching] = useState(false);
  const currentMatchesRef = useRef<CurrentMatch[]>([]);
  const activeSegmentRef = useRef<HTMLElement | null>(null);
  const currentSearchRequestRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();
  const visibleOptions = options
    .filter((option) => showCurrentSearch || option.value !== "current")
    .filter((option) => contentSearchEnabled || option.value !== "content")
    .map((option) => option.value === "current" && currentSearchBookId
      ? {
          ...option,
          label: "本书",
          action: `/books/${currentSearchBookId}/search`,
          placeholder: "搜索本书全部章节",
          ariaLabel: "搜索本书全部章节",
        }
      : option);
  const activeOption = visibleOptions.find((option) => option.value === mode) || visibleOptions[0];
  const showAdvancedOption = showAdvancedSearch && normalizedPathname === "/novels";
  const advancedSearchParams = new URLSearchParams();
  const advancedKeyword = keyword.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (advancedKeyword) {
    advancedSearchParams.set(mode === "content" ? "content" : "q", advancedKeyword);
  }
  if (library && library !== "default") advancedSearchParams.set("library", library);
  const advancedSearchHref = `/tags/search${advancedSearchParams.size ? `?${advancedSearchParams.toString()}` : ""}`;
  const originNovelId = Number(/^\/books\/(\d+)/.exec(normalizedPathname)?.[1] || 0);
  const searchSource = mode === "title" ? "header_title" : mode === "content" ? "header_content" : "reader_current";
  const isPinnedOpen = visibility === "open" || visibility === "default";
  const formClassName = [
    "searchForm",
    mode === "content" ? "isContentSearch" : "",
    showCurrentSearch ? "readerSearchForm" : "",
    visibility === "open" ? "isPinnedOpen" : "",
    visibility === "default" ? "isDefaultOpen" : "",
    isModeMenuOpen ? "isModeMenuOpen" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const currentAvailable = showCurrentSearch && defaultMode === "current";
    const contentAvailable = contentSearchEnabled && defaultMode === "content";
    setMode(currentAvailable || contentAvailable || defaultMode === "title" ? defaultMode : "title");
  }, [contentSearchEnabled, defaultMode, showCurrentSearch]);

  useEffect(() => {
    setKeyword(query);
    if (query.trim()) {
      setVisibility("open");
    }
  }, [query]);

  useEffect(() => {
    if (!isMessageVisible) {
      return;
    }

    if (noticeDisplaySeconds <= 0) {
      return;
    }

    const timer = setTimeout(() => setIsMessageVisible(false), noticeDisplaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [isMessageVisible, message, noticeDisplaySeconds]);

  useEffect(() => {
    if (!showCurrentSearch) {
      return;
    }

    let observer: MutationObserver | null = null;
    let scrollFrame: number | null = null;

    function scrollToInitialPosition(): boolean {
      const target = document.querySelector<HTMLElement>('.readerSegment[data-search-target="true"]');
      if (!target) {
        return false;
      }

      if (window.location.hash === `#${target.id}`) {
        scrollFrame = window.requestAnimationFrame(() => {
          const bounds = target.getBoundingClientRect();
          if (bounds.bottom < 0 || bounds.top > window.innerHeight) {
            target.scrollIntoView({ block: "center" });
          }
        });
      }

      return true;
    }

    if (!scrollToInitialPosition()) {
      observer = new MutationObserver(() => {
        if (scrollToInitialPosition()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      if (scrollFrame !== null) {
        window.cancelAnimationFrame(scrollFrame);
      }
    };
  }, [showCurrentSearch]);

  useEffect(() => {
    return () => {
      if (activeSegmentRef.current) {
        restoreSegment(activeSegmentRef.current);
      }
    };
  }, []);

  function restoreActiveMatch() {
    if (!activeSegmentRef.current) {
      return;
    }

    restoreSegment(activeSegmentRef.current);
    activeSegmentRef.current = null;
  }

  function resetCurrentMatches() {
    currentSearchRequestRef.current += 1;
    restoreActiveMatch();
    currentMatchesRef.current = [];
    setCurrentMatchIndex(-1);
    setCurrentMatchCount(0);
    setIsCurrentSearching(false);
  }

  function showCurrentMatch(nextIndex: number) {
    const matches = currentMatchesRef.current;
    if (!matches.length) {
      return;
    }

    const normalizedIndex = (nextIndex + matches.length) % matches.length;
    const match = matches[normalizedIndex];
    const text = getOriginalSegmentText(match.segment);
    const fragment = document.createDocumentFragment();
    const mark = document.createElement("mark");

    restoreActiveMatch();
    fragment.append(document.createTextNode(text.slice(0, match.start)));
    mark.className = "readerSearchMark isActive";
    mark.textContent = text.slice(match.start, match.end);
    fragment.append(mark);
    fragment.append(document.createTextNode(text.slice(match.end)));
    match.segment.replaceChildren(fragment);
    activeSegmentRef.current = match.segment;
    setCurrentMatchIndex(normalizedIndex);

    window.requestAnimationFrame(() => {
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function chooseMode(value: SearchMode) {
    if (mode === "current" && value !== "current") {
      resetCurrentMatches();
    }
    setMode(value);
    setIsMessageVisible(false);
    if (window.matchMedia("(max-width: 820px)").matches) {
      const input = searchInputRef.current;
      input?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        if (input && document.activeElement !== input) {
          input.focus({ preventScroll: true });
        }
      });
    }
  }

  function showMessage(nextMessage: string, tone: MessageTone) {
    setMessage(nextMessage);
    setMessageTone(tone);
    setIsMessageVisible(true);
  }

  async function searchCurrentBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKeyword = keyword.trim();
    const segments = getReaderSegments();
    resetCurrentMatches();

    if (!segments.length) {
      showMessage(tr("请先打开小说正文页再搜索本文"), "error");
      return;
    }

    if (!nextKeyword) {
      showMessage(tr("请输入要查找的文字"), "warning");
      return;
    }

    const requestId = ++currentSearchRequestRef.current;
    setIsCurrentSearching(true);
    const nextMatches = await findLiteralMatches(segments, nextKeyword, () => currentSearchRequestRef.current === requestId);
    if (currentSearchRequestRef.current !== requestId) {
      return;
    }
    setIsCurrentSearching(false);
    currentMatchesRef.current = nextMatches;
    setCurrentMatchCount(nextMatches.length);
    setIsModeMenuOpen(false);
    void fetch("/api/search/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "current",
        query: nextKeyword,
        resultCount: nextMatches.length,
        originNovelId,
      }),
      keepalive: true,
    }).catch(() => undefined);
    if (nextMatches.length) {
      setMessage("");
      setIsMessageVisible(false);
      showCurrentMatch(0);
    } else {
      showMessage(tr("当前小说没有匹配内容"), "warning");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (mode === "current" && !currentSearchBookId) {
      void searchCurrentBook(event);
      return;
    }
    beginNavigationProgress();
  }

  function togglePinnedSearch(form: HTMLFormElement | null) {
    const input = form?.querySelector<HTMLInputElement>('input[name="q"]') || null;
    const nextPinnedOpen = !isPinnedOpen;
    setVisibility(nextPinnedOpen ? "open" : "closed");
    setIsModeMenuOpen(false);
    if (nextPinnedOpen) {
      window.requestAnimationFrame(() => input?.focus());
    } else {
      input?.blur();
    }
  }

  function closeCurrentFind(form: HTMLFormElement | null) {
    resetCurrentMatches();
    setKeyword("");
    setMessage("");
    setIsMessageVisible(false);
    setIsModeMenuOpen(false);
    setVisibility("closed");
    form?.querySelector<HTMLInputElement>('input[name="q"]')?.blur();
  }

  return (
    <Form
      className={formClassName}
      action={withLocalePath(activeOption.action, locale)}
      role="search"
      onSubmit={handleSubmit}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsModeMenuOpen(false);
        }
      }}
    >
      <button
        className="searchIconButton"
        type="button"
        aria-label={tr(isPinnedOpen ? "收起搜索框" : "展开搜索框")}
        aria-controls={searchInputId}
        aria-expanded={isPinnedOpen}
        title={tr(isPinnedOpen ? "收起搜索框" : "展开搜索框")}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (event.detail > 0) {
            event.currentTarget.blur();
          }
          togglePinnedSearch(event.currentTarget.form);
        }}
      >
        <Search size={20} aria-hidden="true" />
      </button>
      <input
        id={searchInputId}
        ref={searchInputRef}
        name="q"
        type="search"
        value={keyword}
        placeholder={tr(activeOption.placeholder)}
        aria-label={tr(activeOption.ariaLabel || activeOption.placeholder)}
        autoComplete="off"
        onChange={(event) => {
          setKeyword(event.target.value);
          if (mode === "current" && currentMatchesRef.current.length) {
            resetCurrentMatches();
            setIsMessageVisible(false);
          }
        }}
        onClick={() => setIsModeMenuOpen(true)}
      />
      <input name="source" type="hidden" value={searchSource} />
      {library && library !== "default" ? <input name="library" type="hidden" value={library} /> : null}
      {originNovelId ? <input name="origin" type="hidden" value={originNovelId} /> : null}
      {keyword.trim() ? (
        <button
          className="searchClearButton"
          type="button"
          aria-label={tr("清除搜索")}
          title={tr("清除搜索")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setKeyword("");
            if (mode === "current" && currentMatchesRef.current.length) {
              resetCurrentMatches();
              setIsMessageVisible(false);
            }
          }}
        >
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
      {/* Submit via Enter; no second magnifier next to the left toggle icon. */}
      <button
        className="searchSubmit isVisuallyHidden"
        type="submit"
        tabIndex={-1}
        aria-label={`${tr(activeOption.label)}${tr("搜索")}`}
        disabled={isCurrentSearching}
      >
        {tr("搜索")}
      </button>
      {mode === "current" && currentMatchCount > 0 ? (
        <div className="currentFindControls" role="group" aria-label={tr("本文查找结果")}>
          <output aria-live="polite">
            {currentMatchIndex + 1} / {currentMatchCount}
          </output>
          <button
            type="button"
            aria-label={tr("上一个匹配项")}
            title={tr("上一个匹配项")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => showCurrentMatch(currentMatchIndex - 1)}
          >
            <ChevronUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={tr("下一个匹配项")}
            title={tr("下一个匹配项")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => showCurrentMatch(currentMatchIndex + 1)}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={tr("关闭本文查找")}
            title={tr("关闭本文查找")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => closeCurrentFind(event.currentTarget.form)}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {isModeMenuOpen ? (
        <div className="segmentedControl searchModeMenu" role="group" aria-label={tr("搜索范围")}>
          {visibleOptions.map((option) => (
            <button
              className={mode === option.value ? "isActive" : ""}
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => chooseMode(option.value)}
            >
              {tr(option.label)}
            </button>
          ))}
          {showAdvancedOption ? (
            <Link
              href={advancedSearchHref}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setIsModeMenuOpen(false);
                beginNavigationProgress();
              }}
            >
              {tr("高级")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {isMessageVisible && message ? (
        <p className={`searchNotice is${messageTone[0].toUpperCase()}${messageTone.slice(1)}`} role="status">
          {message}
        </p>
      ) : null}
    </Form>
  );
}
