"use client";

import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  List,
  Moon,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import Link from "@/components/LocalizedLink";
import { useEffect, useState, type CSSProperties } from "react";
import {
  DEFAULT_READER_LINE_HEIGHT,
  getReaderThemeSystemTheme,
  isReaderTheme,
  normalizeReaderLineHeight,
  READER_LINE_HEIGHT_STORAGE_KEY,
  READER_PAPER_STORAGE_KEY,
  READER_THEME_OPTIONS,
  type ReaderLineHeight,
  type ReaderTheme,
} from "@/lib/ui-preferences";
import { clearReaderPaperPreference } from "@/lib/reader-theme-client";
import { formatNovelWordCount } from "./CatalogBookGrid";
import { GroveButton } from "./GroveButton";
import { NovelFavoriteButton } from "./NovelFavoriteButton";
import { ReaderFontSizeStepper, ReaderLineHeightStepper } from "./ReaderTypographyControls";
import { ReportNovelButton } from "./ReportNovelButton";

type ChapterItem = { id: number; title: string; wordCount: number };
type ReaderPanel = "directory" | "info" | "settings" | null;
type ReaderWidth = "auto" | 640 | 800 | 900 | 1000 | 1280;

const READER_WIDTH_STORAGE_KEY = "novel-reader-width";
const READER_FONT_SIZE_STORAGE_KEY = "novel-font-size";
const MOBILE_READER_QUERY = "(max-width: 820px)";
const READER_WIDTHS: ReaderWidth[] = ["auto", 640, 800, 900, 1000, 1280];

function chapterHref(bookId: number, chapterId: number, from?: string) {
  return `/books/${bookId}/chapters/${chapterId}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

function isReaderWidth(value: string | null): value is `${ReaderWidth}` {
  return value === "auto" || ["640", "800", "900", "1000", "1280"].includes(value || "");
}

function currentGlobalTheme(): "light" | "dark" {
  const explicitTheme = document.documentElement.dataset.theme;
  if (explicitTheme === "light" || explicitTheme === "dark") return explicitTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
  previous,
  next,
  from,
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
  previous?: ChapterItem | null;
  next?: ChapterItem | null;
  from?: string;
  authenticated: boolean;
  initialInGrove: boolean;
  initialFavorite: boolean;
  canReport: boolean;
}) {
  const [panel, setPanel] = useState<ReaderPanel>(null);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme | null>(null);
  const [globalTheme, setGlobalTheme] = useState<"light" | "dark">("light");
  const [width, setWidth] = useState<ReaderWidth>(800);
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState<ReaderLineHeight>(DEFAULT_READER_LINE_HEIGHT);

  useEffect(() => {
    const root = document.documentElement;
    const shell = document.querySelector<HTMLElement>(".readerShell");
    if (!shell) return;

    const originalThemeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const originalThemeColor = originalThemeColorMeta?.getAttribute("content") ?? null;
    let themeColorMeta = originalThemeColorMeta;
    const mobileViewport = window.matchMedia(MOBILE_READER_QUERY);

    function restoreThemeColor() {
      if (!themeColorMeta) return;
      if (themeColorMeta !== originalThemeColorMeta) {
        themeColorMeta.remove();
        themeColorMeta = originalThemeColorMeta;
      } else if (originalThemeColor === null) {
        themeColorMeta.removeAttribute("content");
      } else {
        themeColorMeta.setAttribute("content", originalThemeColor);
      }
    }

    function syncReaderViewportTheme(theme: ReaderTheme | null) {
      const themeOption = READER_THEME_OPTIONS.find((item) => item.value === theme);
      const viewportColor = themeOption
        ? mobileViewport.matches ? themeOption.paper : themeOption.outer
        : getComputedStyle(shell!).getPropertyValue(mobileViewport.matches ? "--reader-paper" : "--reader-bg").trim();
      if (!viewportColor) {
        root.removeAttribute("data-reader-viewport");
        root.style.removeProperty("--reader-viewport-bg");
        restoreThemeColor();
        return;
      }

      root.dataset.readerViewport = "true";
      root.style.setProperty("--reader-viewport-bg", viewportColor);
      if (!themeColorMeta) {
        themeColorMeta = document.createElement("meta");
        themeColorMeta.setAttribute("name", "theme-color");
        document.head.append(themeColorMeta);
      }
      themeColorMeta.setAttribute("content", viewportColor);
    }

    const savedTheme = localStorage.getItem(READER_PAPER_STORAGE_KEY);
    const savedWidth = localStorage.getItem(READER_WIDTH_STORAGE_KEY);
    const savedFontSize = Number(localStorage.getItem(READER_FONT_SIZE_STORAGE_KEY));
    const savedLineHeight = Number(localStorage.getItem(READER_LINE_HEIGHT_STORAGE_KEY));
    const initialReaderTheme = isReaderTheme(savedTheme) ? savedTheme : null;
    const initialGlobalTheme = initialReaderTheme
      ? getReaderThemeSystemTheme(initialReaderTheme)
      : currentGlobalTheme();
    const initialWidth = isReaderWidth(savedWidth)
      ? savedWidth === "auto" ? "auto" : Number(savedWidth) as ReaderWidth
      : 800;
    const initialFontSize = Number.isFinite(savedFontSize) && savedFontSize >= 8 && savedFontSize <= 25 ? savedFontSize : 18;
    const initialLineHeight = normalizeReaderLineHeight(savedLineHeight, DEFAULT_READER_LINE_HEIGHT);

    setReaderTheme(initialReaderTheme);
    setGlobalTheme(initialGlobalTheme);
    setWidth(initialWidth);
    setFontSize(initialFontSize);
    setLineHeight(initialLineHeight);
    if (initialReaderTheme) {
      root.dataset.theme = initialGlobalTheme;
      localStorage.setItem("novel-theme", initialGlobalTheme);
      shell.dataset.readerTheme = initialReaderTheme;
      root.dataset.readerTheme = initialReaderTheme;
    } else {
      shell.removeAttribute("data-reader-theme");
      root.removeAttribute("data-reader-theme");
    }
    syncReaderViewportTheme(initialReaderTheme);
    shell.dataset.readerWidth = String(initialWidth);
    if (initialWidth !== "auto") shell.style.setProperty("--reader-paper-width", `${initialWidth}px`);
    shell.style.setProperty("--reader-font-size", `${initialFontSize}px`);
    shell.style.setProperty("--reader-line-height", String(initialLineHeight));

    const syncGlobalTheme = () => {
      setGlobalTheme(currentGlobalTheme());
      const nextReaderTheme = localStorage.getItem(READER_PAPER_STORAGE_KEY);
      const normalizedReaderTheme = isReaderTheme(nextReaderTheme) ? nextReaderTheme : null;
      setReaderTheme(normalizedReaderTheme);
      syncReaderViewportTheme(normalizedReaderTheme);
    };
    const themeObserver = new MutationObserver(syncGlobalTheme);
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-reader-theme"] });
    systemTheme.addEventListener("change", syncGlobalTheme);
    mobileViewport.addEventListener("change", syncGlobalTheme);
    return () => {
      themeObserver.disconnect();
      systemTheme.removeEventListener("change", syncGlobalTheme);
      mobileViewport.removeEventListener("change", syncGlobalTheme);
      root.removeAttribute("data-reader-viewport");
      root.style.removeProperty("--reader-viewport-bg");
      restoreThemeColor();
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setPanel(null);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [panel]);

  function getReaderShell() {
    return document.querySelector<HTMLElement>(".readerShell");
  }

  function toggleTheme() {
    const nextTheme = currentGlobalTheme() === "dark" ? "light" : "dark";
    setReaderTheme(null);
    setGlobalTheme(nextTheme);
    clearReaderPaperPreference();
    localStorage.setItem("novel-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  function changeReaderTheme(nextTheme: ReaderTheme) {
    const selectedTheme = readerTheme === nextTheme ? null : nextTheme;
    const nextGlobalTheme = getReaderThemeSystemTheme(nextTheme);
    setReaderTheme(selectedTheme);
    setGlobalTheme(nextGlobalTheme);
    localStorage.setItem("novel-theme", nextGlobalTheme);
    document.documentElement.dataset.theme = nextGlobalTheme;
    const shell = getReaderShell();
    if (selectedTheme) {
      localStorage.setItem(READER_PAPER_STORAGE_KEY, selectedTheme);
      document.documentElement.dataset.readerTheme = selectedTheme;
      if (shell) shell.dataset.readerTheme = selectedTheme;
    } else {
      localStorage.removeItem(READER_PAPER_STORAGE_KEY);
      document.documentElement.removeAttribute("data-reader-theme");
      shell?.removeAttribute("data-reader-theme");
    }
  }

  function changeWidth(nextWidth: ReaderWidth) {
    setWidth(nextWidth);
    localStorage.setItem(READER_WIDTH_STORAGE_KEY, String(nextWidth));
    const shell = getReaderShell();
    if (!shell) return;
    shell.dataset.readerWidth = String(nextWidth);
    if (nextWidth === "auto") shell.style.removeProperty("--reader-paper-width");
    else shell.style.setProperty("--reader-paper-width", `${nextWidth}px`);
  }

  function changeFontSize(value: number) {
    const nextFontSize = Math.min(25, Math.max(8, value));
    setFontSize(nextFontSize);
    localStorage.setItem(READER_FONT_SIZE_STORAGE_KEY, String(nextFontSize));
    getReaderShell()?.style.setProperty("--reader-font-size", `${nextFontSize}px`);
  }

  function changeLineHeight(nextLineHeight: ReaderLineHeight) {
    setLineHeight(nextLineHeight);
    localStorage.setItem(READER_LINE_HEIGHT_STORAGE_KEY, String(nextLineHeight));
    getReaderShell()?.style.setProperty("--reader-line-height", String(nextLineHeight));
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  const panelTitle = panel === "directory" ? "章节目录" : panel === "info" ? "详情" : "设置";
  const readerIsDark = readerTheme ? readerTheme === "night" : globalTheme === "dark";

  return (
    <>
      <aside className="readerToolRail" aria-label="阅读工具">
        <button className="readerToolItem isDirectory" type="button" onClick={() => setPanel("directory")}>
          <List size={20} aria-hidden="true" /><span>目录</span>
        </button>
        <Link className="readerToolItem isMobileChapter isPrevious" href={previous ? chapterHref(bookId, previous.id, from) : "#"} aria-disabled={!previous}>
          <ChevronLeft size={20} aria-hidden="true" /><span>上一章</span>
        </Link>
        <Link className="readerToolItem isMobileChapter isNext" href={next ? chapterHref(bookId, next.id, from) : "#"} aria-disabled={!next}>
          <ChevronRight size={20} aria-hidden="true" /><span>下一章</span>
        </Link>
        <button className="readerToolItem isInfo" type="button" onClick={() => setPanel("info")}>
          <Info size={20} aria-hidden="true" /><span>详情</span>
        </button>
        <button className="readerToolItem isTheme" type="button" onClick={toggleTheme}>
          {readerIsDark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          <span>{readerIsDark ? "日间" : "夜间"}</span>
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
        <button className="readerToolItem isBackTop" type="button" onClick={scrollTop}>
          <ArrowUp size={20} aria-hidden="true" /><span>回顶</span>
        </button>
      </aside>
      {panel ? (
        <div className="readerPanelBackdrop" onMouseDown={(event) => event.target === event.currentTarget && setPanel(null)}>
          <section className={`readerSidePanel is-${panel}`} role="dialog" aria-modal="true" aria-label={panelTitle}>
            <header>
              <div><strong>{panelTitle}</strong>{panel === "directory" ? <small>{chapterCount} 章</small> : null}</div>
              <button type="button" onClick={() => setPanel(null)} aria-label="关闭"><X size={19} /></button>
            </header>
            {panel === "directory" ? (
              chapters.length ? <nav className="readerDirectoryList">
                {chapters.map((chapter, index) => (
                  <Link className={chapter.id === currentChapterId ? "isActive" : ""} href={chapterHref(bookId, chapter.id, from)} key={chapter.id} onClick={() => setPanel(null)}>
                    <span><i>{index + 1}</i>{chapter.title}</span><small>{formatNovelWordCount(chapter.wordCount)}</small>
                  </Link>
                ))}
              </nav> : <p className="readerPanelEmpty">当前为单文件小说，无章节目录。</p>
            ) : null}
            {panel === "info" ? (
              <div className="readerBookInfo">
                <h2>{title}</h2>
                {chapterTitle ? <p className="readerBookChapterTitle">{chapterTitle}</p> : null}
                {description ? <p className="readerBookDescription">{description}</p> : null}
                <dl><div><dt>字数</dt><dd>{formatNovelWordCount(wordCount)}</dd></div><div><dt>章节</dt><dd>{chapterCount ? `${chapterCount}章` : "单篇"}</dd></div></dl>
                {chapterCount ? <Link href={`/books/${bookId}/chapters`} onClick={() => setPanel(null)}>查看完整目录</Link> : null}
              </div>
            ) : null}
            {panel === "settings" ? (
              <div className="readerSettingsPanel">
                <div className="readerSettingRow isThemes">
                  <span>主题</span>
                  <div role="group" aria-label="主题">
                    {READER_THEME_OPTIONS.map((item) => (
                      <button
                        className={readerTheme === item.value ? "isActive" : ""}
                        type="button"
                        key={item.value}
                        onClick={() => changeReaderTheme(item.value)}
                        aria-label={item.label}
                        aria-pressed={readerTheme === item.value}
                        style={{ "--reader-theme-swatch": item.swatch } as CSSProperties}
                      >
                        {readerTheme === item.value ? <Check size={18} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="readerSettingRow isFontSize">
                  <span>字号</span>
                  <ReaderFontSizeStepper value={fontSize} onChange={changeFontSize} />
                </div>
                <div className="readerSettingRow isLineHeight">
                  <span>行距</span>
                  <ReaderLineHeightStepper value={lineHeight} onChange={changeLineHeight} />
                </div>
                <div className="readerSettingRow isWidth">
                  <span>页面宽度</span>
                  <div role="group" aria-label="页面宽度">
                    {READER_WIDTHS.map((item) => (
                      <button className={width === item ? "isActive" : ""} type="button" key={item} onClick={() => changeWidth(item)} aria-pressed={width === item}>
                        {item === "auto" ? "自动" : item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
