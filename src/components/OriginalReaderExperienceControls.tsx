"use client";

import { ArrowUp, ChevronLeft, ChevronRight, List, PenLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/LocalizedLink";
import type { OriginalOutlineItem } from "@/lib/original-outline";
import { ContentFavoriteButton } from "./ContentFavoriteButton";
import { GroveButton } from "./GroveButton";
import { OriginalTipButton } from "./OriginalTipButton";
import { keepReaderChromeVisible, ReaderSidePanel, ReaderToolRail } from "./ReaderChrome";
import { ReportOriginalButton } from "./ReportOriginalButton";

type AdjacentArticle = { slug: string; title: string };
type OriginalReaderPanel = "directory" | null;

export function OriginalReaderExperienceControls({
  articleId,
  title,
  items,
  previous,
  next,
  authenticated,
  canTip,
  canReport,
  initialFavorite,
  initialInGrove,
  editHref,
}: {
  articleId: number;
  title: string;
  items: OriginalOutlineItem[];
  previous: AdjacentArticle | null;
  next: AdjacentArticle | null;
  authenticated: boolean;
  canTip: boolean;
  canReport: boolean;
  initialFavorite: boolean;
  initialInGrove: boolean;
  editHref?: string;
}) {
  const [panel, setPanel] = useState<OriginalReaderPanel>(null);
  const [activeId, setActiveId] = useState(items[0]?.id || "");

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

  function scrollTop() {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  return (
    <>
      <ReaderToolRail label="文章阅读工具">
        {editHref ? (
          <Link className="readerToolItem isEdit" href={editHref} onClick={keepReaderChromeVisible}>
            <PenLine size={20} aria-hidden="true" /><span>编辑</span>
          </Link>
        ) : null}
        {previousHref ? (
          <Link className="readerToolItem isMobileChapter isPrevious" href={previousHref} onClick={keepReaderChromeVisible}>
            <ChevronLeft size={20} aria-hidden="true" /><span>上一篇</span>
          </Link>
        ) : (
          <button className="readerToolItem isMobileChapter isPrevious" type="button" disabled>
            <ChevronLeft size={20} aria-hidden="true" /><span>上一篇</span>
          </button>
        )}
        {nextHref ? (
          <Link className="readerToolItem isMobileChapter isNext" href={nextHref} onClick={keepReaderChromeVisible}>
            <ChevronRight size={20} aria-hidden="true" /><span>下一篇</span>
          </Link>
        ) : (
          <button className="readerToolItem isMobileChapter isNext" type="button" disabled>
            <ChevronRight size={20} aria-hidden="true" /><span>下一篇</span>
          </button>
        )}
        {items.length ? (
          <button className="readerToolItem isDirectory" type="button" onClick={() => setPanel("directory")}>
            <List size={20} aria-hidden="true" /><span>目录</span>
          </button>
        ) : null}
        {canTip ? <span className="readerToolItem readerToolAction isTip"><OriginalTipButton articleId={articleId} /></span> : null}
        {authenticated ? <span className="readerToolItem readerToolAction isGrove"><GroveButton contentType="original" contentId={articleId} initialPlanted={initialInGrove} showLabel /></span> : null}
        {authenticated ? <span className="readerToolItem readerToolAction isFavorite"><ContentFavoriteButton collection="original" contentId={articleId} initialFavorite={initialFavorite} showLabel /></span> : null}
        {canReport ? <span className="readerToolItem readerToolAction isReport"><ReportOriginalButton articleId={articleId} title={title} variant="responsive" /></span> : null}
        <button className="readerToolItem isBackTop" type="button" onClick={scrollTop}><ArrowUp size={20} aria-hidden="true" /><span>回顶</span></button>
      </ReaderToolRail>
      {panel ? (
        <ReaderSidePanel kind="directory" title="目录" meta={<small>{items.length} 节</small>} onClose={closePanel}>
          {items.length ? <OutlineLinks items={items} activeId={activeId} onNavigate={closePanel} /> : <p className="readerPanelEmpty">正文没有标题目录。</p>}
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
      {items.map((item, index) => (
        <a
          className={item.id === activeId ? "isActive" : ""}
          aria-current={item.id === activeId ? "location" : undefined}
          href={`#${item.id}`}
          key={item.id}
          onClick={() => {
            keepReaderChromeVisible();
            onNavigate?.();
          }}
        >
          <span style={{ paddingInlineStart: `${Math.max(item.level - 1, 0) * 10}px` }}><i>{index + 1}</i>{item.text}</span>
        </a>
      ))}
    </nav>
  );
}
