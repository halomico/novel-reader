"use client";

import { Check, ListChecks, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReadingProgress } from "@/lib/reading-progress";
import { uiText, type AppLocale } from "@/lib/locale";
import Link from "./LocalizedLink";
import { ContextNavigationLink } from "./ContextNavigationLink";
import { LocalDateTime } from "./LocalDateTime";
import { Pagination } from "./Pagination";

export function ReadingHistoryList({
  initialItems,
  page,
  totalPages,
  locale,
  historyEnabled,
}: {
  initialItems: ReadingProgress[];
  page: number;
  totalPages: number;
  locale: AppLocale;
  historyEnabled: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, setPending] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [readingHistoryEnabled, setReadingHistoryEnabled] = useState(historyEnabled);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const tr = (text: string) => uiText(locale, text);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.novelId));

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    setReadingHistoryEnabled(historyEnabled);
  }, [historyEnabled]);

  function toggleSelected(novelId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(novelId)) next.delete(novelId);
      else next.add(novelId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => (
      allSelected
        ? new Set()
        : new Set(items.map((item) => item.novelId))
    ));
    setConfirmClear(false);
  }

  async function updateReadingHistory(enabled: boolean) {
    if (historyPending) return;
    const previous = readingHistoryEnabled;
    setReadingHistoryEnabled(enabled);
    if (!enabled) {
      setManaging(false);
      setSelected(new Set());
      setConfirmClear(false);
    }
    setHistoryPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readingHistoryEnabled: enabled }),
      });
      if (!response.ok) throw new Error("preference update failed");
      router.refresh();
    } catch {
      setReadingHistoryEnabled(previous);
      setMessage(tr("设置保存失败，请稍后重试"));
    } finally {
      setHistoryPending(false);
    }
  }

  async function removeSelected() {
    if (!selected.size || pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/account/reading-progress", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelIds: Array.from(selected) }),
      });
      if (!response.ok) throw new Error("delete failed");
      setItems((current) => current.filter((item) => !selected.has(item.novelId)));
      setSelected(new Set());
      setManaging(false);
      setMessage(tr("记录已删除"));
      router.refresh();
    } catch {
      setMessage(tr("删除失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  async function clearAll() {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/account/reading-progress?all=1", { method: "DELETE" });
      if (!response.ok) throw new Error("clear failed");
      setItems([]);
      setSelected(new Set());
      setManaging(false);
      setConfirmClear(false);
      setMessage(tr("最近记录已清空"));
      router.refresh();
    } catch {
      setMessage(tr("清空失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="readingHistory">
      <div className="readingProgressSetting">
        <strong>{tr("阅读进度")}</strong>
        <div className="readingProgressOptions">
          <label className="settingToggle readingProgressOption">
            <input
              type="checkbox"
              checked={readingHistoryEnabled}
              disabled={historyPending}
              onChange={(event) => void updateReadingHistory(event.target.checked)}
              aria-label={tr("阅读记录")}
            />
            <span className="settingToggleTrack" aria-hidden="true"><span /></span>
          </label>
        </div>
      </div>
      {message ? <p className="readingHistoryNotice" role="status">{message}</p> : null}
      {readingHistoryEnabled && items.length ? (
        <div className="readingHistoryToolbar">
          {managing ? (
            <label className="activitySelectAll">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span aria-hidden="true"><Check size={12} /></span>
              <em>{tr("全选")}</em>
            </label>
          ) : null}
          <button
            className={managing ? "iconLink isActive" : "iconLink"}
            type="button"
            aria-label={tr(managing ? "完成管理" : "管理最近记录")}
            title={tr(managing ? "完成" : "管理")}
            onClick={() => {
              setManaging((value) => !value);
              setSelected(new Set());
              setConfirmClear(false);
            }}
          >
            {managing ? <Check size={18} aria-hidden="true" /> : <ListChecks size={18} aria-hidden="true" />}
          </button>
        </div>
      ) : null}
      {readingHistoryEnabled && items.length ? (
        <div className="readingHistoryList">
          {items.map((item, index) => {
            const progress = Math.round(item.progressPercent);
            const isContinueItem = page === 1 && index === 0 && !item.completed && progress > 0;
            return (
              <article className={selected.has(item.novelId) ? "readingHistoryItem isSelected" : "readingHistoryItem"} key={item.novelId}>
                {managing ? (
                  <label className="readingHistorySelect">
                    <input
                      type="checkbox"
                      checked={selected.has(item.novelId)}
                      onChange={() => toggleSelected(item.novelId)}
                      aria-label={`${tr("选择")} ${item.title}`}
                    />
                    <span aria-hidden="true"><Check size={13} /></span>
                  </label>
                ) : null}
                <ContextNavigationLink
                  className="readingHistoryMain"
                  href={item.chapterId
                    ? `/books/${item.novelId}/chapters/${item.chapterId}?resume=1`
                    : `/books/${item.novelId}?resume=1`}
                  prefetch={false}
                >
                  <span className="readingHistoryCopy">
                    <strong>{item.title}</strong>
                    <small>
                      {isContinueItem ? <span className="readingHistoryResumeLabel">{tr("继续阅读")}</span> : null}
                      {isContinueItem ? <span aria-hidden="true">·</span> : null}
                      {item.completed ? tr("已读完") : progress > 0 ? `${progress}%` : null}
                      {item.completed || progress > 0 ? <span aria-hidden="true">·</span> : null}
                      <LocalDateTime value={item.lastReadAt} />
                    </small>
                  </span>
                  <span className="readingHistoryProgress" aria-label={`${tr("阅读进度")} ${progress}%`}>
                    <span style={{ width: `${Math.max(progress, item.progressPercent > 0 ? 1 : 0)}%` }} />
                  </span>
                </ContextNavigationLink>
              </article>
            );
          })}
        </div>
      ) : readingHistoryEnabled && !historyPending ? (
        <div className="activityEmpty">
          <p>{tr("还没有最近阅读")}</p>
          <Link href="/novels">{tr("去看看小说")}</Link>
        </div>
      ) : null}
      {readingHistoryEnabled && managing && items.length ? (
        <div className="readingHistoryActions">
          <button type="button" disabled={!selected.size || pending} onClick={removeSelected}>
            <Trash2 size={16} aria-hidden="true" />
            {tr("删除")}
          </button>
          {confirmClear ? (
            <span className="readingHistoryClearConfirm">
              <button type="button" disabled={pending} onClick={clearAll} aria-label={tr("确认清空")} title={tr("确认清空")}>
                <Check size={16} aria-hidden="true" />
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirmClear(false)} aria-label={tr("取消")} title={tr("取消")}>
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirmClear(true)}>
              {tr("清空")}
            </button>
          )}
        </div>
      ) : null}
      {readingHistoryEnabled && items.length ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          query=""
          basePath="/activity"
          extraParams={{ view: "recent" }}
        />
      ) : null}
    </section>
  );
}
