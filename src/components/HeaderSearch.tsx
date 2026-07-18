"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { FormEvent, useEffect, useId, useRef, useState } from "react";

type SearchMode = "title" | "content" | "current";
type MessageTone = "success" | "warning" | "error";
type SearchVisibility = "default" | "open" | "closed";
type UiMode = "standard" | "minimal";
type CurrentMatch = {
  segment: HTMLElement;
  start: number;
  end: number;
};

const options: Array<{ value: SearchMode; label: string; action: string; placeholder: string; ariaLabel?: string }> = [
  { value: "title", label: "书名", action: "/novels", placeholder: "搜索小说名" },
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
  noticeDisplaySeconds = 5,
  noticeStayVisibleAfterBlur = false,
}: {
  query?: string;
  defaultMode?: SearchMode;
  defaultExpanded?: boolean;
  showCurrentSearch?: boolean;
  noticeDisplaySeconds?: number;
  noticeStayVisibleAfterBlur?: boolean;
}) {
  const [mode, setMode] = useState<SearchMode>(defaultMode);
  const [keyword, setKeyword] = useState(query);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [visibility, setVisibility] = useState<SearchVisibility>(() => (
    query.trim() ? "open" : defaultExpanded ? "default" : "closed"
  ));
  const [uiMode, setUiMode] = useState<UiMode>("standard");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("success");
  const [isMessageVisible, setIsMessageVisible] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [currentMatchCount, setCurrentMatchCount] = useState(0);
  const [isCurrentSearching, setIsCurrentSearching] = useState(false);
  const currentMatchesRef = useRef<CurrentMatch[]>([]);
  const activeSegmentRef = useRef<HTMLElement | null>(null);
  const currentSearchRequestRef = useRef(0);
  const searchInputId = useId();
  const visibleOptions = showCurrentSearch ? options : options.filter((option) => option.value !== "current");
  const activeOption = visibleOptions.find((option) => option.value === mode) || visibleOptions[0];
  const isPinnedOpen = visibility === "open" || (visibility === "default" && uiMode === "standard");
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
    setMode(defaultMode === "current" && !showCurrentSearch ? "title" : defaultMode);
  }, [defaultMode, showCurrentSearch]);

  useEffect(() => {
    function syncUiMode() {
      setUiMode(document.documentElement.dataset.uiMode === "minimal" ? "minimal" : "standard");
    }

    syncUiMode();
    const observer = new MutationObserver(syncUiMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui-mode"] });
    return () => observer.disconnect();
  }, []);

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

    let timer: ReturnType<typeof setTimeout> | null = null;
    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function hideAfterDelay() {
      clearTimer();
      if (noticeDisplaySeconds > 0) {
        timer = setTimeout(() => setIsMessageVisible(false), noticeDisplaySeconds * 1000);
      } else {
        setIsMessageVisible(false);
      }
    }

    if (noticeDisplaySeconds > 0) {
      timer = setTimeout(() => setIsMessageVisible(false), noticeDisplaySeconds * 1000);
    }

    function hideOnWindowBlur() {
      if (!noticeStayVisibleAfterBlur) {
        hideAfterDelay();
      }
    }

    window.addEventListener("blur", hideOnWindowBlur);
    return () => {
      clearTimer();
      window.removeEventListener("blur", hideOnWindowBlur);
    };
  }, [isMessageVisible, message, noticeDisplaySeconds, noticeStayVisibleAfterBlur]);

  useEffect(() => {
    if (!showCurrentSearch) {
      return;
    }

    let activeSegment: HTMLElement | null = null;
    let previousTabIndex: string | null = null;
    let cleared = false;
    let observer: MutationObserver | null = null;
    let scrollFrame: number | null = null;

    function clearInitialHighlight() {
      if (cleared || !activeSegment) {
        return;
      }

      cleared = true;
      activeSegment.classList.remove("isHit");
      if (previousTabIndex === null) {
        activeSegment.removeAttribute("tabindex");
      } else {
        activeSegment.setAttribute("tabindex", previousTabIndex);
      }
      activeSegment.removeEventListener("blur", clearInitialHighlight);
      document.removeEventListener("pointerdown", clearOnOutsidePointer);
    }

    function clearOnOutsidePointer(event: PointerEvent) {
      if (activeSegment && !activeSegment.contains(event.target as Node)) {
        clearInitialHighlight();
      }
    }

    function activateInitialHighlight(): boolean {
      const highlightedSegment = document.querySelector<HTMLElement>(".readerSegment.isHit");
      if (!highlightedSegment) {
        return false;
      }

      activeSegment = highlightedSegment;
      previousTabIndex = highlightedSegment.getAttribute("tabindex");
      highlightedSegment.tabIndex = -1;
      highlightedSegment.focus({ preventScroll: true });
      highlightedSegment.addEventListener("blur", clearInitialHighlight);
      document.addEventListener("pointerdown", clearOnOutsidePointer);

      if (window.location.hash === `#${highlightedSegment.id}`) {
        scrollFrame = window.requestAnimationFrame(() => {
          const bounds = highlightedSegment.getBoundingClientRect();
          if (bounds.bottom < 0 || bounds.top > window.innerHeight) {
            highlightedSegment.scrollIntoView({ block: "center" });
          }
        });
      }

      return true;
    }

    if (!activateInitialHighlight()) {
      observer = new MutationObserver(() => {
        if (activateInitialHighlight()) {
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
      activeSegment?.removeEventListener("blur", clearInitialHighlight);
      document.removeEventListener("pointerdown", clearOnOutsidePointer);
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
      showMessage("请先打开小说正文页再搜索本文", "error");
      return;
    }

    if (!nextKeyword) {
      showMessage("请输入要查找的文字", "warning");
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
    if (nextMatches.length) {
      setMessage("");
      setIsMessageVisible(false);
      showCurrentMatch(0);
    } else {
      showMessage("当前小说没有匹配内容", "warning");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (mode === "current") {
      void searchCurrentBook(event);
    }
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
    <form
      className={formClassName}
      action={activeOption.action}
      method="get"
      role="search"
      onSubmit={handleSubmit}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsModeMenuOpen(false);
          if (!noticeStayVisibleAfterBlur) {
            window.setTimeout(() => setIsMessageVisible(false), Math.max(noticeDisplaySeconds, 0) * 1000);
          }
        }
      }}
    >
      <button
        className="searchIconButton"
        type="button"
        aria-label={isPinnedOpen ? "收起搜索框" : "展开搜索框"}
        aria-controls={searchInputId}
        aria-expanded={isPinnedOpen}
        title={isPinnedOpen ? "收起搜索框" : "展开搜索框"}
        onClick={(event) => togglePinnedSearch(event.currentTarget.form)}
      >
        <Search size={18} aria-hidden="true" />
      </button>
      <input
        id={searchInputId}
        name="q"
        type="search"
        value={keyword}
        placeholder={activeOption.placeholder}
        aria-label={activeOption.ariaLabel || activeOption.placeholder}
        onChange={(event) => {
          setKeyword(event.target.value);
          if (mode === "current" && currentMatchesRef.current.length) {
            resetCurrentMatches();
            setIsMessageVisible(false);
          }
        }}
        onClick={() => setIsModeMenuOpen(true)}
      />
      <button className="searchSubmit" type="submit" aria-label={`按${activeOption.label}搜索`} title={`按${activeOption.label}搜索`} disabled={isCurrentSearching}>
        <Search className="searchSubmitIcon" size={16} aria-hidden="true" />
        <span>搜索</span>
      </button>
      {mode === "current" && currentMatchCount > 0 ? (
        <div className="currentFindControls" role="group" aria-label="本文查找结果">
          <output aria-live="polite">
            {currentMatchIndex + 1} / {currentMatchCount}
          </output>
          <button
            type="button"
            aria-label="上一个匹配项"
            title="上一个匹配项"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => showCurrentMatch(currentMatchIndex - 1)}
          >
            <ChevronUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="下一个匹配项"
            title="下一个匹配项"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => showCurrentMatch(currentMatchIndex + 1)}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="关闭本文查找"
            title="关闭本文查找"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => closeCurrentFind(event.currentTarget.form)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {isModeMenuOpen ? (
        <div className="searchModeMenu" role="group" aria-label="搜索范围">
          {visibleOptions.map((option) => (
            <button
              className={mode === option.value ? "isActive" : ""}
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {isMessageVisible && message ? (
        <p className={`searchNotice is${messageTone[0].toUpperCase()}${messageTone.slice(1)}`} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
