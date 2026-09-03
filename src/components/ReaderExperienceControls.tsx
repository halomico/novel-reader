"use client";

import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Info,
  List,
  Moon,
  Settings2,
  Sun,
} from "lucide-react";
import Link from "@/components/LocalizedLink";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { localeFromPathname } from "@/lib/locale";
import {
  READER_PAGE_REQUEST_EVENT,
  READER_PAGE_STATE_EVENT,
  READER_PAGE_STATE_REQUEST_EVENT,
  type ReaderPageState,
} from "@/lib/reader-layout";
import { normalizeReaderPageTurn } from "@/lib/ui-preferences";
import { formatNovelWordCount } from "./CatalogBookGrid";
import { GroveButton } from "./GroveButton";
import { NovelFavoriteButton } from "./NovelFavoriteButton";
import { ReportNovelButton } from "./ReportNovelButton";
import { keepReaderChromeVisible, ReaderSidePanel, ReaderToolRail } from "./ReaderChrome";
import { ReaderDisplaySettingsPanel, useReaderDisplayPreferences } from "./ReaderDisplayPreferences";

type ChapterItem = { id: number; title: string; wordCount: number };
type NavigationItem = { id: number; title: string };
type ReaderPanel = "directory" | "info" | "settings" | null;

const MOBILE_READER_QUERY = "(max-width: 820px)";

function chapterHref(bookId: number, chapterId: number, from?: string) {
  return `/books/${bookId}/chapters/${chapterId}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

export function ReaderExperienceControls({
  bookId,
  title,
  description,
  chapterTitle,
  wordCount,
  chapterCount,
  chapters,
  currentChapterId,
  navigationKind,
  previous,
  next,
  from,
  returnHref,
  authenticated,
  initialInGrove,
  initialFavorite,
  canReport,
}: {
  bookId: number;
  title: string;
  description?: string;
  chapterTitle?: string;
  wordCount: number;
  chapterCount: number;
  chapters: ChapterItem[];
  currentChapterId?: number;
  navigationKind: "chapter" | "novel";
  previous?: NavigationItem | null;
  next?: NavigationItem | null;
  from?: string;
  returnHref?: string;
  authenticated: boolean;
  initialInGrove: boolean;
  initialFavorite: boolean;
  canReport: boolean;
}) {
  const [panel, setPanel] = useState<ReaderPanel>(null);
  const preferences = useReaderDisplayPreferences({ pageTurnEnabled: true });
  const [pageState, setPageState] = useState<ReaderPageState>({
    paged: false,
    index: 0,
    count: 1,
    canPrevious: Boolean(previous),
    canNext: Boolean(next),
  });
  const locale = localeFromPathname(usePathname());

  function keepReaderChrome() {
    keepReaderChromeVisible();
  }

  function requestPage(direction: -1 | 1) {
    keepReaderChrome();
    window.dispatchEvent(new CustomEvent(READER_PAGE_REQUEST_EVENT, {
      detail: { direction, keepChrome: true },
    }));
  }

  function closeReaderPanel() {
    setPanel(null);
    if (
      window.matchMedia(MOBILE_READER_QUERY).matches &&
      normalizeReaderPageTurn(document.documentElement.dataset.readerPageTurn) !== "scroll"
    ) {
      document.documentElement.classList.add("isReaderChromeHidden");
    }
  }

  useEffect(() => {
    function handlePageState(event: Event) {
      setPageState((event as CustomEvent<ReaderPageState>).detail);
    }
    window.addEventListener(READER_PAGE_STATE_EVENT, handlePageState);
    window.dispatchEvent(new Event(READER_PAGE_STATE_REQUEST_EVENT));
    return () => window.removeEventListener(READER_PAGE_STATE_EVENT, handlePageState);
  }, []);

  const panelTitle = panel === "directory" ? "章节目录" : panel === "info" ? "详情" : "设置";
  const previousLabel = navigationKind === "chapter" ? "上一章" : "上一篇";
  const nextLabel = navigationKind === "chapter" ? "下一章" : "下一篇";
  const navigationHref = (item: NavigationItem) => navigationKind === "chapter"
    ? chapterHref(bookId, item.id, from)
    : `/books/${item.id}?from=${encodeURIComponent(returnHref || "/novels")}`;

  return (
    <>
      <ReaderToolRail>
        <button className="readerToolItem isDirectory" type="button" onClick={() => setPanel("directory")}>
          <List size={20} aria-hidden="true" /><span>目录</span>
        </button>
        {pageState.paged ? (
          <button className="readerToolItem isMobileChapter isPrevious" type="button" disabled={!pageState.canPrevious} onClick={() => requestPage(-1)}>
            <ChevronLeft size={20} aria-hidden="true" /><span>上一页</span>
          </button>
        ) : (
          <Link className="readerToolItem isMobileChapter isPrevious" href={previous ? navigationHref(previous) : "#"} aria-disabled={!previous} onClick={previous ? keepReaderChrome : undefined}>
            <ChevronLeft size={20} aria-hidden="true" /><span>{previousLabel}</span>
          </Link>
        )}
        {pageState.paged ? (
          <button className="readerToolItem isMobileChapter isNext" type="button" disabled={!pageState.canNext} onClick={() => requestPage(1)}>
            <ChevronRight size={20} aria-hidden="true" /><span>下一页</span>
          </button>
        ) : (
          <Link className="readerToolItem isMobileChapter isNext" href={next ? navigationHref(next) : "#"} aria-disabled={!next} onClick={next ? keepReaderChrome : undefined}>
            <ChevronRight size={20} aria-hidden="true" /><span>{nextLabel}</span>
          </Link>
        )}
        <button className="readerToolItem isInfo" type="button" onClick={() => setPanel("info")}>
          <Info size={20} aria-hidden="true" /><span>详情</span>
        </button>
        <button className="readerToolItem isTheme" type="button" onClick={preferences.toggleTheme}>
          {preferences.readerIsDark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          <span>{preferences.readerIsDark ? "日间" : "夜间"}</span>
        </button>
        {authenticated ? (
          <span className="readerToolItem readerToolAction isGrove"><GroveButton contentType="novel" contentId={bookId} initialPlanted={initialInGrove} showLabel /></span>
        ) : null}
        {authenticated ? (
          <span className="readerToolItem readerToolAction isFavorite"><NovelFavoriteButton novelId={bookId} initialFavorite={initialFavorite} showLabel /></span>
        ) : null}
        {canReport ? <span className="readerToolItem readerToolAction isReport"><ReportNovelButton novelId={bookId} title={title} variant="responsive" /></span> : null}
        <button className="readerToolItem isSettings" type="button" onClick={() => setPanel("settings")}>
          <Settings2 size={20} aria-hidden="true" /><span>设置</span>
        </button>
        <button className="readerToolItem isBackTop" type="button" onClick={preferences.scrollTop}>
          <ArrowUp size={20} aria-hidden="true" /><span>回顶</span>
        </button>
      </ReaderToolRail>
      {panel ? (
        <ReaderSidePanel kind={panel} title={panelTitle} meta={panel === "directory" ? <small>{chapterCount} 章</small> : null} onClose={closeReaderPanel}>
            {panel === "directory" ? (
              chapters.length ? <nav className="readerDirectoryList">
                {chapters.map((chapter, index) => (
                  <Link className={chapter.id === currentChapterId ? "isActive" : ""} href={chapterHref(bookId, chapter.id, from)} key={chapter.id} onClick={() => { keepReaderChrome(); setPanel(null); }}>
                    <span><i>{index + 1}</i>{chapter.title}</span><small>{formatNovelWordCount(chapter.wordCount, locale)}</small>
                  </Link>
                ))}
              </nav> : <p className="readerPanelEmpty">当前为单文件小说，无章节目录。</p>
            ) : null}
            {panel === "info" ? (
              <div className="readerBookInfo">
                <h2>{title}</h2>
                {chapterTitle ? <p className="readerBookChapterTitle">{chapterTitle}</p> : null}
                {description ? <p className="readerBookDescription">{description}</p> : null}
                <dl><div><dt>字数</dt><dd>{formatNovelWordCount(wordCount, locale)}</dd></div><div><dt>章节</dt><dd>{chapterCount ? `${chapterCount}章` : "单篇"}</dd></div></dl>
                {chapterCount ? <Link href={`/books/${bookId}/chapters`} onClick={closeReaderPanel}>查看完整目录</Link> : null}
              </div>
            ) : null}
            {panel === "settings" ? (
              <ReaderDisplaySettingsPanel preferences={preferences} showPageTurn showJustify />
            ) : null}
        </ReaderSidePanel>
      ) : null}
    </>
  );
}
