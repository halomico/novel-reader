"use client";

import { Search } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

type SearchMode = "title" | "content" | "current";
type MessageTone = "success" | "warning" | "error";
type HeaderSearchResult = {
  segmentIndex: string;
  snippet: string;
};

const options: Array<{ value: SearchMode; label: string; action: string; placeholder: string }> = [
  { value: "title", label: "书名", action: "/", placeholder: "搜索小说名" },
  { value: "content", label: "正文", action: "/search", placeholder: "搜索全部小说正文" },
  { value: "current", label: "本文", action: "/search", placeholder: "搜索本文" },
];

const originalTextBySegment = new WeakMap<HTMLElement, string>();

function createSnippet(content: string, keyword: string): string {
  const index = content.indexOf(keyword);
  if (index < 0) {
    return content.trim().slice(0, 100);
  }

  const start = Math.max(0, index - 44);
  const end = Math.min(content.length, index + keyword.length + 68);
  return `${start > 0 ? "..." : ""}${content.slice(start, end).trim()}${end < content.length ? "..." : ""}`;
}

function getReaderSegments(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".readerSegment"));
}

function restoreSegment(segment: HTMLElement) {
  const originalText = originalTextBySegment.get(segment);
  if (originalText === undefined) {
    return;
  }

  segment.replaceChildren(document.createTextNode(originalText));
}

function clearHighlights(segments: HTMLElement[]) {
  for (const segment of segments) {
    restoreSegment(segment);
    segment.classList.remove("isClientHit");
  }
}

function highlightSegment(segment: HTMLElement, keyword: string) {
  const text = originalTextBySegment.get(segment) || segment.textContent || "";
  if (!originalTextBySegment.has(segment)) {
    originalTextBySegment.set(segment, text);
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let index = text.indexOf(keyword, cursor);

  while (index >= 0) {
    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
    }

    const mark = document.createElement("mark");
    mark.className = "readerSearchMark";
    mark.textContent = keyword;
    fragment.append(mark);

    cursor = index + keyword.length;
    index = text.indexOf(keyword, cursor);
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  segment.replaceChildren(fragment);
}

export function HeaderSearch({
  query = "",
  defaultMode = "title",
  showCurrentSearch = false,
}: {
  query?: string;
  defaultMode?: SearchMode;
  showCurrentSearch?: boolean;
}) {
  const [mode, setMode] = useState<SearchMode>(defaultMode);
  const [keyword, setKeyword] = useState(query);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isPinnedOpen, setIsPinnedOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("success");
  const [isMessageVisible, setIsMessageVisible] = useState(false);
  const [results, setResults] = useState<HeaderSearchResult[]>([]);
  const [isCurrentPanelOpen, setIsCurrentPanelOpen] = useState(false);
  const visibleOptions = showCurrentSearch ? options : options.filter((option) => option.value !== "current");
  const activeOption = visibleOptions.find((option) => option.value === mode) || visibleOptions[0];

  useEffect(() => {
    setMode(defaultMode === "current" && !showCurrentSearch ? "title" : defaultMode);
  }, [defaultMode, showCurrentSearch]);

  useEffect(() => {
    setKeyword(query);
  }, [query]);

  useEffect(() => {
    if (!isMessageVisible) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsMessageVisible(false);
    }, 15_000);

    return () => window.clearTimeout(timer);
  }, [isMessageVisible, message]);

  useEffect(() => {
    const highlightedSegment = document.querySelector<HTMLElement>(".readerSegment.isHit");
    if (!highlightedSegment) {
      return;
    }

    const activeSegment = highlightedSegment;
    const previousTabIndex = activeSegment.getAttribute("tabindex");
    let cleared = false;
    activeSegment.tabIndex = -1;
    activeSegment.focus({ preventScroll: true });

    function clearInitialHighlight() {
      if (cleared) {
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
      if (!activeSegment.contains(event.target as Node)) {
        clearInitialHighlight();
      }
    }

    activeSegment.addEventListener("blur", clearInitialHighlight);
    document.addEventListener("pointerdown", clearOnOutsidePointer);

    return () => {
      activeSegment.removeEventListener("blur", clearInitialHighlight);
      document.removeEventListener("pointerdown", clearOnOutsidePointer);
    };
  }, []);

  function chooseMode(value: SearchMode) {
    setMode(value);
    if (value !== "current") {
      setIsCurrentPanelOpen(false);
    }
  }

  function showMessage(nextMessage: string, tone: MessageTone) {
    setMessage(nextMessage);
    setMessageTone(tone);
    setIsMessageVisible(true);
  }

  function searchCurrentBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKeyword = keyword.trim();
    const length = Array.from(nextKeyword).length;
    const segments = getReaderSegments();
    clearHighlights(segments);

    if (!segments.length) {
      showMessage("请先打开小说正文页再搜索本文", "error");
      setResults([]);
      setIsCurrentPanelOpen(false);
      return;
    }

    if (length < 2 || length > 30) {
      showMessage("请输入 2 到 30 个字的关键字", "warning");
      setResults([]);
      setIsCurrentPanelOpen(false);
      return;
    }

    const nextResults: HeaderSearchResult[] = [];

    for (const segment of segments) {
      const text = segment.textContent || "";
      if (text.includes(nextKeyword)) {
        highlightSegment(segment, nextKeyword);
        nextResults.push({
          segmentIndex: segment.dataset.segmentIndex || "0",
          snippet: createSnippet(text, nextKeyword),
        });
      }

      if (nextResults.length >= 50) {
        break;
      }
    }

    setResults(nextResults);
    showMessage(nextResults.length ? `找到 ${nextResults.length} 处` : "当前小说没有匹配内容", nextResults.length ? "success" : "warning");
    setIsCurrentPanelOpen(nextResults.length > 0);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (mode === "current") {
      searchCurrentBook(event);
    }
  }

  function jumpToSegment(segmentIndex: string) {
    const target = document.getElementById(`seg-${segmentIndex}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.classList.add("isClientHit");
    window.setTimeout(() => target?.classList.remove("isClientHit"), 1800);
  }

  function togglePinnedSearch(form: HTMLFormElement | null) {
    setIsModeMenuOpen(true);
    setIsPinnedOpen((current) => {
      const nextPinnedOpen = !current;
      if (nextPinnedOpen) {
        window.requestAnimationFrame(() => {
          form?.querySelector<HTMLInputElement>('input[name="q"]')?.focus();
        });
      }
      return nextPinnedOpen;
    });
  }

  return (
    <form
      className={isPinnedOpen ? "searchForm isPinnedOpen" : "searchForm"}
      action={activeOption.action}
      method="get"
      role="search"
      onSubmit={handleSubmit}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsModeMenuOpen(false);
          setIsCurrentPanelOpen(false);
          setIsMessageVisible(false);
        }
      }}
    >
      <button
        className="searchIconButton"
        type="button"
        aria-label={isPinnedOpen ? "收起搜索框" : "展开搜索框"}
        title={isPinnedOpen ? "收起搜索框" : "展开搜索框"}
        onPointerDown={(event) => {
          event.preventDefault();
          togglePinnedSearch(event.currentTarget.form);
        }}
        onClick={(event) => {
          if (event.detail === 0) {
            togglePinnedSearch(event.currentTarget.form);
          }
        }}
      >
        <Search size={18} aria-hidden="true" />
      </button>
      <input
        name="q"
        type="search"
        value={keyword}
        placeholder={activeOption.placeholder}
        aria-label={activeOption.placeholder}
        onChange={(event) => setKeyword(event.target.value)}
        onFocus={() => {
          setIsModeMenuOpen(true);
          if (mode === "current" && (message || results.length > 0)) {
            setIsCurrentPanelOpen(true);
          }
        }}
        onClick={() => setIsModeMenuOpen(true)}
      />
      <button className="searchSubmit" type="submit" aria-label={`按${activeOption.label}搜索`} title={`按${activeOption.label}搜索`}>
        搜索
      </button>
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
      {mode === "current" && isCurrentPanelOpen && results.length > 0 ? (
        <div className="currentSearchPanel">
          <div className="currentSearchResults">
            {results.map((result) => (
              <button
                key={result.segmentIndex}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => jumpToSegment(result.segmentIndex)}
              >
                {result.snippet}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </form>
  );
}
