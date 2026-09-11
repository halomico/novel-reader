"use client";

import { ArrowUp, ChevronLeft, ChevronRight, Ellipsis, Info, List, MessageCircle, PenLine, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/LocalizedLink";
import type { OriginalOutlineItem } from "@/lib/original-outline";
import { ContentFavoriteButton } from "./ContentFavoriteButton";
import { GroveButton } from "./GroveButton";
import { OriginalTipButton } from "./OriginalTipButton";
import { keepReaderChromeVisible, ReaderSidePanel, ReaderToolRail } from "./ReaderChrome";
import { ReportOriginalButton } from "./ReportOriginalButton";
import { ReaderDisplaySettingsPanel, useReaderDisplayPreferences } from "./ReaderDisplayPreferences";
import { OPEN_ORIGINAL_COMMENT_COMPOSER_EVENT } from "@/lib/original-comments";

type AdjacentArticle = { slug: string; title: string };
type OriginalReaderPanel = "directory" | "info" | "more" | "settings" | null;

export function OriginalReaderExperienceControls({
  articleId,
  title,
  items,
  previous,
  next,
  authenticated,
  canTip,
  initialTipped,
  canReport,
  initialFavorite,
  initialInGrove,
  editHref,
  wordCount,
  commentComposerAvailable,
}: {
  articleId: number;
  title: string;
  items: OriginalOutlineItem[];
  previous: AdjacentArticle | null;
  next: AdjacentArticle | null;
  authenticated: boolean;
  canTip: boolean;
  initialTipped: boolean;
  canReport: boolean;
  initialFavorite: boolean;
  initialInGrove: boolean;
  editHref?: string;
  wordCount: number;
  commentComposerAvailable: boolean;
}) {
  const [panel, setPanel] = useState<OriginalReaderPanel>(null);
  const [activeId, setActiveId] = useState(items[0]?.id || "");
  const preferences = useReaderDisplayPreferences({ pageTurnEnabled: false });

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((item): item is HTMLElement => Boolean(item));
    if (!headings.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible?.target.id) setActiveId(visible.target.id);
    }, { rootMargin: "-12% 0px -72% 0px", threshold: [0, 1] });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [items]);

  const closePanel = useCallback(() => {
    setPanel(null);
    keepReaderChromeVisible();
  }, []);

  const previousHref = previous ? `/original/${encodeURIComponent(previous.slug)}` : null;
  const nextHref = next ? `/original/${encodeURIComponent(next.slug)}` : null;

  function scrollTop(behavior: ScrollBehavior = "smooth") {
    window.scrollTo({
      top: 0,
      behavior: behavior === "smooth" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : behavior,
    });
  }

  return (
    <>
      <ReaderToolRail label="文章阅读工具">
        {editHref ? (
          <Link className="readerToolItem isEdit isSecondary" href={editHref} onClick={keepReaderChromeVisible}>
            <PenLine size={20} aria-hidden="true" /><span>编辑</span>
          </Link>
        ) : null}
        {previousHref ? (
          <Link className="readerToolItem isMobileChapter isPrevious" href={previousHref} prefetch onClick={keepReaderChromeVisible}>
            <ChevronLeft size={20} aria-hidden="true" /><span>上一篇</span>
          </Link>
        ) : (
          <button className="readerToolItem isMobileChapter isPrevious" type="button" disabled>
            <ChevronLeft size={20} aria-hidden="true" /><span>上一篇</span>
          </button>
        )}
        {nextHref ? (
          <Link className="readerToolItem isMobileChapter isNext" href={nextHref} prefetch onClick={keepReaderChromeVisible}>
            <ChevronRight size={20} aria-hidden="true" /><span>下一篇</span>
          </Link>
        ) : (
          <button className="readerToolItem isMobileChapter isNext" type="button" disabled>
            <ChevronRight size={20} aria-hidden="true" /><span>下一篇</span>
          </button>
        )}
        {items.length ? (
          <button
            className="readerToolItem isDirectory"
            type="button"
            aria-expanded={panel === "directory"}
            // One button, two states: show the outline and hide it again.
            onClick={() => setPanel((current) => current === "directory" ? null : "directory")}
          >
            <List size={20} aria-hidden="true" /><span>目录</span>
          </button>
        ) : <button className="readerToolItem isDirectory" type="button" disabled><List size={20} aria-hidden="true" /><span>目录</span></button>}
        <button className="readerToolItem isInfo isSecondary" type="button" onClick={() => setPanel("info")}><Info size={20} aria-hidden="true" /><span>详情</span></button>
        {canTip ? <span className="readerToolItem readerToolAction isTip isSecondary"><OriginalTipButton articleId={articleId} initialTipped={initialTipped} /></span> : null}
        {authenticated ? <span className="readerToolItem readerToolAction isGrove isSecondary"><GroveButton contentType="original" contentId={articleId} initialPlanted={initialInGrove} showLabel /></span> : null}
        {authenticated ? <span className="readerToolItem readerToolAction isFavorite isSecondary"><ContentFavoriteButton collection="original" contentId={articleId} initialFavorite={initialFavorite} showLabel /></span> : null}
        {canReport ? <span className="readerToolItem readerToolAction isReport isSecondary"><ReportOriginalButton articleId={articleId} title={title} variant="responsive" /></span> : null}
        {commentComposerAvailable ? (
          <button
            className="readerToolItem isComment"
            type="button"
            aria-label="发表评论"
            title="发表评论"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_ORIGINAL_COMMENT_COMPOSER_EVENT, { detail: { articleId } }))}
          >
            <MessageCircle size={20} aria-hidden="true" /><span>评论</span>
          </button>
        ) : (
          <a className="readerToolItem isComment" href="#original-comments" aria-label="查看评论" title="查看评论">
            <MessageCircle size={20} aria-hidden="true" /><span>评论</span>
          </a>
        )}
        <button className="readerToolItem isSettings isSecondary" type="button" onClick={() => setPanel("settings")}><Settings2 size={20} aria-hidden="true" /><span>设置</span></button>
        <button className="readerToolItem isBackTop isSecondary" type="button" onClick={() => scrollTop()}><ArrowUp size={20} aria-hidden="true" /><span>回顶</span></button>
        <button className="readerToolItem isMore" type="button" onClick={() => setPanel("more")}><Ellipsis size={21} aria-hidden="true" /><span>更多</span></button>
      </ReaderToolRail>
      {panel ? (
        <ReaderSidePanel kind={panel} title={panel === "directory" ? "目录" : panel === "info" ? "详情" : panel === "settings" ? "阅读设置" : "更多"} meta={panel === "directory" ? <small>{items.length} 节</small> : null} onClose={closePanel}>
          {/* Same drawer as the novel reader: choosing a section scrolls to it and
              hands the page back to the reader. */}
          {panel === "directory" ? (items.length ? <OutlineLinks items={items} activeId={activeId} onNavigate={closePanel} /> : <p className="readerPanelEmpty">正文没有标题目录。</p>) : null}
          {panel === "info" ? <div className="readerBookInfo"><h2>{title}</h2><dl><div><dt>字数</dt><dd>{wordCount.toLocaleString("zh-CN")} 字</dd></div><div><dt>目录</dt><dd>{items.length} 节</dd></div></dl></div> : null}
          {panel === "settings" ? <ReaderDisplaySettingsPanel preferences={preferences} showPageTurn={false} /> : null}
          {panel === "more" ? <div className="readerMoreMenu" role="menu" aria-label="更多阅读操作">
            {editHref ? <Link className="readerMoreAction" href={editHref} onClick={keepReaderChromeVisible}><PenLine size={20} aria-hidden="true" /><span>编辑</span></Link> : null}
            <button className="readerMoreAction" type="button" onClick={() => setPanel("info")}><Info size={20} aria-hidden="true" /><span>详情</span></button>
            <button className="readerMoreAction" type="button" onClick={() => setPanel("settings")}><Settings2 size={20} aria-hidden="true" /><span>设置</span></button>
            {canTip ? <span className="readerMoreAction readerToolAction"><OriginalTipButton articleId={articleId} initialTipped={initialTipped} /></span> : null}
            {authenticated ? <span className="readerMoreAction readerToolAction"><GroveButton contentType="original" contentId={articleId} initialPlanted={initialInGrove} showLabel /></span> : null}
            {authenticated ? <span className="readerMoreAction readerToolAction"><ContentFavoriteButton collection="original" contentId={articleId} initialFavorite={initialFavorite} showLabel /></span> : null}
            {canReport ? <span className="readerMoreAction readerToolAction"><ReportOriginalButton articleId={articleId} title={title} variant="responsive" /></span> : null}
            <button className="readerMoreAction" type="button" onClick={() => { closePanel(); scrollTop(); }}><ArrowUp size={20} aria-hidden="true" /><span>回顶</span></button>
          </div> : null}
        </ReaderSidePanel>
      ) : null}
    </>
  );
}

function OutlineLinks({
  items,
  activeId,
  onNavigate,
}: {
  items: OriginalOutlineItem[];
  activeId: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="readerDirectoryList originalReaderDirectory">
      {items.map((item) => (
        <a
          className={item.id === activeId ? "isActive" : ""}
          aria-current={item.id === activeId ? "location" : undefined}
          href={`#${item.id}`}
          key={item.id}
          title={item.text}
          onClick={(event) => {
            // A bare `#id` jump parks the heading under the fixed site header. Scroll
            // it to a readable position instead, and still leave the plain link in the
            // markup so it works without JavaScript and can be copied.
            const target = document.getElementById(item.id);
            if (target) {
              event.preventDefault();
              window.scrollTo({
                top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - readerHeadingOffset()),
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              });
              history.replaceState(null, "", `#${item.id}`);
            }
            keepReaderChromeVisible();
            onNavigate?.();
          }}
        >
          <span style={{ paddingInlineStart: `${Math.min(Math.max(item.level - 1, 0), 3) * 12}px` }}>{item.text}</span>
        </a>
      ))}
    </nav>
  );
}

/**
 * Height of the chrome that floats over the top of the article, plus breathing room.
 * Sticky counts as well as fixed: a sticky site header parks itself over the first
 * lines of whatever a plain `#id` jump scrolls to, which is exactly the "the toolbar
 * covers the heading I clicked" complaint.
 */
function readerHeadingOffset(): number {
  const header = document.querySelector<HTMLElement>(".siteHeader");
  if (!header) return 20;
  const position = getComputedStyle(header).position;
  const overlaps = position === "fixed" || position === "sticky";
  return (overlaps ? header.getBoundingClientRect().height : 0) + 20;
}
