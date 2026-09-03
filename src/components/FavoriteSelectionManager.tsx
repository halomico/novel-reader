"use client";

import { BookmarkMinus, Check, ListChecks, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { uiText, type AppLocale } from "@/lib/locale";

type FavoriteKind = "novel" | "original" | "video" | "audio";

type FavoriteSelectionContextValue = {
  managing: boolean;
  removed: ReadonlySet<number>;
  selectLabel: string;
  selected: ReadonlySet<number>;
  toggle: (id: number) => void;
};

const FavoriteSelectionContext = createContext<FavoriteSelectionContextValue | null>(null);

export function FavoriteSelectionManager({
  kind,
  visibleIds,
  locale,
  children,
}: {
  kind: FavoriteKind;
  visibleIds: number[];
  locale: AppLocale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const tr = (text: string) => uiText(locale, text);
  const activeVisibleIds = visibleIds.filter((id) => !removed.has(id));
  const allVisibleSelected =
    activeVisibleIds.length > 0 && activeVisibleIds.every((id) => selected.has(id));

  const contextValue = useMemo<FavoriteSelectionContextValue>(() => ({
    managing,
    removed,
    selectLabel: tr("选择"),
    selected,
    toggle(id: number) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setConfirming(false);
    },
  }), [locale, managing, removed, selected]);

  function toggleManaging() {
    setManaging((current) => {
      if (current) {
        setSelected(new Set());
        setConfirming(false);
      }
      return !current;
    });
    setMessage("");
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        activeVisibleIds.forEach((id) => next.delete(id));
      } else {
        activeVisibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
    setConfirming(false);
  }

  async function removeSelected() {
    const ids = Array.from(selected);
    if (!ids.length || pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/account/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ids }),
      });
      if (!response.ok) throw new Error("remove failed");
      setRemoved((current) => new Set([...current, ...ids]));
      setSelected(new Set());
      setConfirming(false);
      setManaging(false);
      setMessage(tr("已取消收藏"));
      router.refresh();
    } catch {
      setMessage(tr("操作失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <FavoriteSelectionContext.Provider value={contextValue}>
      <div className="favoriteManageToolbar readingHistoryToolbar">
        {managing ? (
          <label className="activitySelectAll">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={!activeVisibleIds.length}
              onChange={toggleVisible}
            />
            <span aria-hidden="true"><Check size={12} /></span>
            <em>{tr("全选")}</em>
          </label>
        ) : <span aria-hidden="true" />}
        <div className="readingHistoryManageActions">
          {message ? <span className="readingHistorySelectedCount" role="status">{message}</span> : null}
          <button
            className={managing ? "activityManageButton isActive" : "activityManageButton"}
            type="button"
            aria-label={tr(managing ? "完成管理" : "管理收藏")}
            title={tr(managing ? "完成" : "管理")}
            onClick={toggleManaging}
          >
            {managing ? <Check size={16} aria-hidden="true" /> : <ListChecks size={16} aria-hidden="true" />}
            <span>{tr(managing ? "完成" : "管理")}</span>
          </button>
        </div>
      </div>
      <div className={managing ? "favoriteCollection isManaging" : "favoriteCollection"}>
        {children}
      </div>
      {managing ? (
        <div className="readingHistoryActions favoriteManageActions">
          {confirming ? (
            <span className="readingHistoryClearConfirm">
              <button
                type="button"
                disabled={pending}
                onClick={removeSelected}
                aria-label={tr("确认取消收藏")}
                title={tr("确认取消收藏")}
              >
                <Check size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                aria-label={tr("取消")}
                title={tr("取消")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={!selected.size || pending}
              onClick={() => setConfirming(true)}
            >
              <BookmarkMinus size={16} aria-hidden="true" />
              {tr("取消收藏")}
            </button>
          )}
        </div>
      ) : null}
    </FavoriteSelectionContext.Provider>
  );
}

export function FavoriteSelectableItem({
  id,
  label,
  className = "",
  children,
}: {
  id: number;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const context = useContext(FavoriteSelectionContext);
  if (!context || context.removed.has(id)) {
    return context?.removed.has(id) ? null : <>{children}</>;
  }
  const selected = context.selected.has(id);
  return (
    <div
      className={`favoriteSelectableItem${selected ? " isSelected" : ""}${className ? ` ${className}` : ""}`}
      onClickCapture={(event) => {
        if (!context.managing) return;
        const target = event.target;
        if (target instanceof Element && target.closest(".favoriteSelectControl")) return;
        event.preventDefault();
        context.toggle(id);
      }}
    >
      {context.managing ? (
        <label className="favoriteSelectControl">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => context.toggle(id)}
            aria-label={`${context.selectLabel} ${label}`}
          />
          <span aria-hidden="true"><Check size={12} /></span>
        </label>
      ) : null}
      {children}
    </div>
  );
}
