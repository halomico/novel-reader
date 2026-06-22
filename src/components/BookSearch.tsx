"use client";

import { Search } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

type BookSearchResult = {
  segmentIndex: string;
  snippet: string;
};

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

export function BookSearch() {
  const [keyword, setKeyword] = useState("");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

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

  function searchCurrentBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKeyword = keyword.trim();
    const length = Array.from(nextKeyword).length;
    const segments = getReaderSegments();
    clearHighlights(segments);

    if (length < 2 || length > 30) {
      setMessage("请输入 2 到 30 个字的关键字");
      setResults([]);
      setIsPanelOpen(true);
      return;
    }

    const nextResults: BookSearchResult[] = [];

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
    setMessage(nextResults.length ? `找到 ${nextResults.length} 处` : "当前小说没有匹配内容");
    setIsPanelOpen(true);
  }

  function jumpToSegment(segmentIndex: string) {
    const target = document.getElementById(`seg-${segmentIndex}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.classList.add("isClientHit");
    window.setTimeout(() => target?.classList.remove("isClientHit"), 1800);
  }

  return (
    <section
      className="bookSearch"
      aria-label="本书正文搜索"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsPanelOpen(false);
        }
      }}
    >
      <form className="bookSearchForm" onSubmit={searchCurrentBook}>
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onFocus={() => setIsPanelOpen(true)}
          placeholder="搜索本书正文"
          aria-label="搜索本书正文"
        />
        <button type="submit" aria-label="搜索本书正文" title="搜索本书正文">
          <Search size={17} aria-hidden="true" />
        </button>
      </form>
      {isPanelOpen && (message || results.length > 0) ? (
        <div className="bookSearchPanel">
          {message ? <p className="searchMessage">{message}</p> : null}
          {results.length > 0 ? (
            <div className="bookSearchResults">
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
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
