"use client";

import { Check, ListX, SquareCheckBig, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { uiText, type AppLocale } from "@/lib/locale";
import Link from "./LocalizedLink";
import { ContextNavigationLink } from "./ContextNavigationLink";
import { LocalDateTime } from "./LocalDateTime";
import { Pagination } from "./Pagination";
import { UserAvatar } from "./UserAvatar";

export type ReadingHistoryListItem = {
  id: number;
  title: string;
  href: string;
  progressPercent: number;
  completed: boolean;
  lastReadAt: string;
  author?: {
    id: number;
    name: string;
    avatarPath: string | null;
  };
};

export function ReadingHistoryList({
  initialItems,
  page,
  totalPages,
  locale,
  historyEnabled,
  kind,
}: {
  initialItems: ReadingHistoryListItem[];
  page: number;
  totalPages: number;
  locale: AppLocale;
  historyEnabled: boolean;
  kind: "novel" | "original";
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
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    setReadingHistoryEnabled(historyEnabled);
  }, [historyEnabled]);

  function toggleSelected(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => (
      allSelected
        ? new Set()
        : new Set(items.map((item) => item.id))
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
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ readingHistoryEnabled: enabled, readingHistoryKind: kind }),
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
      const response = await fetch(kind === "original" ? "/api/account/original-reading-progress" : "/api/account/reading-progress", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify(kind === "original"
          ? { articleIds: Array.from(selected) }
          : { novelIds: Array.from(selected) }),
      });
      if (!response.ok) throw new Error("delete failed");
      setItems((current) => current.filter((item) => !selected.has(item.id)));
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
      const endpoint = kind === "original"
        ? "/api/account/original-reading-progress?all=1"
        : "/api/account/reading-progress?all=1";
      const response = await fetch(endpoint, { method: "DELETE" });
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
      <div className={managing ? "readingProgressSetting isManaging" : "readingProgressSetting"}>
        <div className="readingProgressHeading">
          <strong>{tr("阅读进度")}</strong>
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
        <div className="readingProgressControls">
          {readingHistoryEnabled && items.length ? (
            <button
              className={managing ? "activityManageButton isActive" : "activityManageButton"}
              type="button"
              aria-label={tr(managing ? "完成管理" : "管理最近记录")}
              title={tr(managing ? "完成" : "管理")}
              onClick={() => {
                setManaging((value) => !value);
                setSelected(new Set());
                setConfirmClear(false);
              }}
            >
              {managing ? <Check size={16} aria-hidden="true" /> : <SquareCheckBig size={16} aria-hidden="true" />}
              <span>{tr(managing ? "完成" : "管理")}</span>
            </button>
          ) : null}
        </div>
        {readingHistoryEnabled && items.length && managing ? (
          <div className="readingHistoryToolbar isManaging">
            <label className="activitySelectAll">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span aria-hidden="true"><Check size={12} /></span>
              <em>{tr("全选")}</em>
            </label>
            <div className="readingHistoryManageActions">
              <span className="readingHistorySelectedCount" aria-live="polite">
                {selected.size ? [tr("已选"), selected.size].join(" ") : ""}
              </span>
              <button
                className="activityBatchButton isDanger"
                type="button"
                disabled={!selected.size || pending}
                onClick={removeSelected}
                aria-label={tr("删除所选")}
                title={tr("删除所选")}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
              {confirmClear ? (
                <span className="readingHistoryClearConfirm">
                  <span>{tr("清空全部")}？</span>
                  <button className="isDanger" type="button" disabled={pending} onClick={clearAll} aria-label={tr("确认清空")} title={tr("确认清空")}>
                    <Check size={15} aria-hidden="true" />
                  </button>
                  <button type="button" disabled={pending} onClick={() => setConfirmClear(false)} aria-label={tr("取消")} title={tr("取消")}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <button
                  className="activityBatchButton"
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmClear(true)}
                  aria-label={tr("清空全部")}
                  title={tr("清空全部")}
                >
                  <ListX size={17} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {message ? <p className="readingHistoryNotice" role="status">{message}</p> : null}
      {readingHistoryEnabled && items.length ? (
        <div className="readingHistoryList">
          {items.map((item, index) => {
            const progress = Math.round(item.progressPercent);
            const isContinueItem = page === 1 && index === 0 && !item.completed && progress > 0;
            return (
              <article className={selected.has(item.id) ? "readingHistoryItem isSelected" : "readingHistoryItem"} key={item.id}>
                {managing ? (
                  <label className="readingHistorySelect">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label={`${tr("选择")} ${item.title}`}
                    />
                    <span aria-hidden="true"><Check size={13} /></span>
                  </label>
                ) : null}
                <ContextNavigationLink
                  className={item.author ? "readingHistoryMain hasAuthor" : "readingHistoryMain"}
                  href={item.href}
                  prefetch={false}
                >
                  {item.author ? (
                    <UserAvatar
                      className="readingHistoryAuthorAvatar"
                      userId={item.author.id}
                      displayName={item.author.name}
                      avatarPath={item.author.avatarPath}
                    />
                  ) : null}
                  <span className="readingHistoryCopy">
                    <strong>{item.title}</strong>
                    <small>
                      {item.author ? <span>{item.author.name}</span> : null}
                      {item.author ? <span aria-hidden="true">·</span> : null}
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
          <Link href={kind === "original" ? "/original" : "/novels"}>{tr(kind === "original" ? "去看看原创" : "去看看小说")}</Link>
        </div>
      ) : null}
      {readingHistoryEnabled && items.length ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          query=""
          basePath="/activity"
          extraParams={{ view: "recent", type: kind === "original" ? "original" : undefined }}
        />
      ) : null}
    </section>
  );
}
