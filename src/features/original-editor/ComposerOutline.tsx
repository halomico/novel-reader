"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { OUTLINE_SCROLL_MARGIN, type OutlineItem } from "./composer-document";
import styles from "./OriginalComposer.module.css";

/**
 * The composer's table of contents: the chapter titles and nothing else. It sits in the
 * page margin without taking layout space; the 目录 button shows and hides it, a title
 * highlights under the pointer and a click scrolls the workspace to that chapter.
 *
 * Ids come from the heading anchors the document carries, so repeated or reordered
 * titles resolve correctly, and nothing here touches the document or its undo history.
 */
export function ComposerOutline({
  items,
  containerRef,
  onClose,
}: {
  items: OutlineItem[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !items.length) return;
    const headings = items
      .map((item) => container.querySelector<HTMLElement>(`[id="${CSS.escape(item.id)}"]`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!headings.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible?.target.id) setActiveId(visible.target.id);
    }, { root: container, rootMargin: "0px 0px -70% 0px", threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [containerRef, items]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function goTo(id: string) {
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!container || !target) return;
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({
      top: Math.max(0, container.scrollTop + offset - OUTLINE_SCROLL_MARGIN),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    setActiveId(id);
  }

  return (
    <div
      className={styles.outlineBackdrop}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <nav className={styles.outline} aria-label="文章目录">
        <header className={styles.outlineHeader}>
          <strong>目录</strong>
          <button
            type="button"
            className={styles.outlineCloseButton}
            onClick={onClose}
            aria-label="关闭目录"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.outlineBody}>
          {items.length ? items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === activeId ? styles.outlineActive : undefined}
              aria-current={item.id === activeId ? "location" : undefined}
              style={{ paddingInlineStart: `${8 + Math.min(Math.max(item.level - 1, 0), 2) * 12}px` }}
              title={item.text}
              onClick={() => {
                goTo(item.id);
                if (typeof window !== "undefined" && window.innerWidth <= 820) {
                  onClose();
                }
              }}
            >
              {item.text}
            </button>
          )) : <p className={styles.outlineEmpty}>暂无章节</p>}
        </div>
      </nav>
    </div>
  );
}
