"use client";

import {
  ArrowUp,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Flag,
  Info,
  List,
  Settings2,
  Trees,
} from "lucide-react";
import Link from "@/components/LocalizedLink";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { localeFromPathname } from "@/lib/locale";
import { normalizeReaderPageTurn } from "@/lib/ui-preferences";
import { formatNovelWordCount } from "./CatalogBookGrid";
import { GroveButton } from "./GroveButton";
import { NovelFavoriteButton } from "./NovelFavoriteButton";
import { ReportNovelButton } from "./ReportNovelButton";
import { keepReaderChromeVisible, ReaderSidePanel, ReaderToolRail } from "./ReaderChrome";
import { ReaderDisplaySettingsPanel, useReaderDisplayPreferences } from "./ReaderDisplayPreferences";

type ChapterItem = { id: number; title: string; wordCount: number };
type NavigationItem = { id: number; title: string };
type ReaderPanel = "directory" | "info" | "settings" | "more" | null;

const MOBILE_READER_QUERY = "(max-width: 820px)";

function chapterHref(bookId: number, chapterId: number, from?: string) {
  return `/books/${bookId}/chapters/${chapterId}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

function scrollReaderToTop() {
  window.scrollTo({ top: 0, behavior: "auto" });
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
  const pathname = usePathname();
  const locale = localeFromPathname(pathname);
  const [panel, setPanel] = useState<ReaderPanel>(null);
  const preferences = useReaderDisplayPreferences({ pageTurnEnabled: true });
  function keepReaderChrome() {
    keepReaderChromeVisible();
  }

  function prepareChapterNavigation() {
    keepReaderChrome();
    scrollReaderToTop();
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

  const panelTitle = panel === "directory" ? "章节目录" : panel === "info" ? "详情" : panel === "more" ? "更多" : "设置";
  // The reader rail is a document-level navigator. Keep its wording stable
  // across chapter and single-file novels; horizontal page turns stay a
  // gesture/edge interaction rather than a second set of page buttons.
  const previousLabel = "上一篇";
  const nextLabel = "下一篇";
  const navigationHref = (item: NavigationItem) => navigationKind === "chapter"
    ? chapterHref(bookId, item.id, from)
    : `/books/${item.id}?from=${encodeURIComponent(returnHref || "/novels")}`;
  return (
    <>
      <ReaderToolRail>
        <button className="readerToolItem isDirectory" type="button" onClick={() => setPanel("directory")}>
          <List size={20} aria-hidden="true" /><span>目录</span>
        </button>
        {previous ? (
          <Link className="readerToolItem isMobileChapter isPrevious" href={navigationHref(previous)} prefetch={false} onClick={prepareChapterNavigation} title={`${previousLabel}：${previous.title}`}>
            <ChevronLeft size={20} aria-hidden="true" /><span>{previousLabel}</span>
          </Link>
        ) : (
          <span className="readerToolItem isMobileChapter isPrevious isDisabled" aria-disabled="true" title={`没有${previousLabel}`}>
            <ChevronLeft size={20} aria-hidden="true" /><span>{previousLabel}</span>
          </span>
        )}
        {next ? (
          <Link className="readerToolItem isMobileChapter isNext" href={navigationHref(next)} prefetch={false} onClick={prepareChapterNavigation} title={`${nextLabel}：${next.title}`}>
            <ChevronRight size={20} aria-hidden="true" /><span>{nextLabel}</span>
          </Link>
        ) : (
          <span className="readerToolItem isMobileChapter isNext isDisabled" aria-disabled="true" title={`没有${nextLabel}`}>
            <ChevronRight size={20} aria-hidden="true" /><span>{nextLabel}</span>
          </span>
        )}
        <button className="readerToolItem isInfo isSecondary" type="button" onClick={() => setPanel("info")}>
          <Info size={20} aria-hidden="true" /><span>详情</span>
        </button>
        {authenticated ? (
          <span className="readerToolItem readerToolAction isGrove isSecondary"><GroveButton contentType="novel" contentId={bookId} initialPlanted={initialInGrove} showLabel /></span>
        ) : (
          <Link className="readerToolItem readerToolAction isGrove isSecondary" href={`/login?returnTo=${encodeURIComponent(returnHref || pathname)}`} title="登录后加入回响林">
            <Trees size={20} aria-hidden="true" /><span>回响林</span>
          </Link>
        )}
        {authenticated ? (
          <span className="readerToolItem readerToolAction isFavorite isSecondary"><NovelFavoriteButton novelId={bookId} initialFavorite={initialFavorite} showLabel /></span>
        ) : (
          <Link className="readerToolItem readerToolAction isFavorite isSecondary" href={`/login?returnTo=${encodeURIComponent(returnHref || pathname)}`} title="登录后收藏">
            <Bookmark size={20} aria-hidden="true" /><span>收藏</span>
          </Link>
        )}
        {canReport ? (
          <span className="readerToolItem readerToolAction isReport isSecondary"><ReportNovelButton novelId={bookId} title={title} variant="responsive" /></span>
        ) : (
          <Link className="readerToolItem readerToolAction isReport isSecondary" href={`/login?returnTo=${encodeURIComponent(returnHref || pathname)}`} title="登录后反馈问题">
            <Flag size={20} aria-hidden="true" /><span>反馈</span>
          </Link>
        )}
        <button className="readerToolItem isSettings" type="button" onClick={() => setPanel("settings")}>
          <Settings2 size={20} aria-hidden="true" /><span>设置</span>
        </button>
        <button className="readerToolItem isBackTop isSecondary" type="button" onClick={preferences.scrollTop}>
          <ArrowUp size={20} aria-hidden="true" /><span>回顶</span>
        </button>
        <button className="readerToolItem isMore" type="button" onClick={() => setPanel("more")}>
          <Ellipsis size={21} aria-hidden="true" /><span>更多</span>
        </button>
      </ReaderToolRail>
      {panel ? (
        <ReaderSidePanel kind={panel} title={panelTitle} meta={panel === "directory" ? <small>{chapterCount} 章</small> : null} onClose={closeReaderPanel}>
            {panel === "directory" ? (
              chapters.length ? <nav className="readerDirectoryList">
                {chapters.map((chapter) => (
                  <Link className={chapter.id === currentChapterId ? "isActive" : ""} href={chapterHref(bookId, chapter.id, from)} key={chapter.id} prefetch={false} onClick={() => { keepReaderChrome(); setPanel(null); }}>
                    <span>{chapter.title}</span><small>{formatNovelWordCount(chapter.wordCount, locale)}</small>
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
                {chapterCount ? <button type="button" onClick={() => setPanel("directory")}>查看完整目录</button> : null}
              </div>
            ) : null}
            {panel === "settings" ? (
              <ReaderDisplaySettingsPanel preferences={preferences} showPageTurn showJustify />
            ) : null}
            {panel === "more" ? (
              <div className="readerMoreMenu" role="menu" aria-label="更多阅读操作">
                <button className="readerMoreAction" type="button" onClick={() => setPanel("info")}><Info size={20} aria-hidden="true" /><span>详情</span></button>
                {authenticated ? (
                  <span className="readerMoreAction readerToolAction"><GroveButton contentType="novel" contentId={bookId} initialPlanted={initialInGrove} showLabel /></span>
                ) : (
                  <Link className="readerMoreAction" href={`/login?returnTo=${encodeURIComponent(returnHref || pathname)}`}><Trees size={20} aria-hidden="true" /><span>回响林</span></Link>
                )}
                {authenticated ? (
                  <span className="readerMoreAction readerToolAction"><NovelFavoriteButton novelId={bookId} initialFavorite={initialFavorite} showLabel /></span>
                ) : (
                  <Link className="readerMoreAction" href={`/login?returnTo=${encodeURIComponent(returnHref || pathname)}`}><Bookmark size={20} aria-hidden="true" /><span>收藏</span></Link>
                )}
                {canReport ? (
                  <span className="readerMoreAction readerToolAction"><ReportNovelButton novelId={bookId} title={title} variant="responsive" /></span>
                ) : (
                  <Link className="readerMoreAction" href={`/login?returnTo=${encodeURIComponent(returnHref || pathname)}`}><Flag size={20} aria-hidden="true" /><span>反馈</span></Link>
                )}
                <button className="readerMoreAction" type="button" onClick={() => setPanel("directory")}><List size={20} aria-hidden="true" /><span>目录</span></button>
              </div>
            ) : null}
        </ReaderSidePanel>
      ) : null}
    </>
  );
}
