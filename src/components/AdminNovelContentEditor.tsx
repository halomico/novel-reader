"use client";

import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

type LoadState = "idle" | "loading" | "ready" | "error";

export function AdminNovelContentEditor({ bookId }: { bookId: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>("idle");
  const [content, setContent] = useState("");

  async function loadContent() {
    setState("loading");
    try {
      const response = await fetch(`/admin/books/${bookId}/content`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("正文读取失败");
      }
      setContent(await response.text());
      setState("ready");
    } catch {
      setState("error");
    }
  }

  function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && state === "idle") {
      void loadContent();
    }
  }

  return (
    <section className={open ? "adminBookEditorSection adminNovelContentSection isOpen" : "adminBookEditorSection adminNovelContentSection"}>
      <button className="adminNovelContentToggle" type="button" onClick={toggle} aria-expanded={open}>
        <span>
          <strong>正文内容</strong>
          <small>{state === "ready" ? "已加载，可直接编辑" : "点击时才读取原文件"}</small>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {open ? (
        <div className="adminNovelContentBody">
          {state === "loading" ? (
            <p className="adminNovelContentStatus"><LoaderCircle className="isSpinning" size={18} aria-hidden="true" />正在读取正文</p>
          ) : state === "error" ? (
            <p className="adminNovelContentStatus isError">
              正文读取失败
              <button type="button" onClick={() => void loadContent()}><RefreshCw size={15} aria-hidden="true" />重试</button>
            </p>
          ) : state === "ready" ? (
            <textarea
              className="adminNovelContentEditor"
              name="content"
              rows={30}
              defaultValue={content}
              spellCheck={false}
              required
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
