"use client";

import { Check, ListChecks, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { jsonMutationRequest } from "@/core/security/browser-mutation";
import { uiText, type AppLocale } from "@/lib/locale";
import { OriginalDraftDeleteButton } from "./OriginalDraftDeleteButton";
import { SelectionCheckbox } from "./SelectionCheckbox";
import Link from "./LocalizedLink";

export type OriginalDraftListItem = {
  id: number;
  title: string;
  updatedLabel: string;
};

export function OriginalDraftManager({ initialItems, locale }: {
  initialItems: OriginalDraftListItem[];
  locale: AppLocale;
}) {
  const router = useRouter();
  const tr = (text: string) => uiText(locale, text);
  const [items, setItems] = useState(initialItems);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  useEffect(() => {
    setItems(initialItems);
    setSelected(new Set());
    setConfirming(false);
  }, [initialItems]);

  function toggleManaging() {
    setManaging((current) => !current);
    setSelected(new Set());
    setConfirming(false);
    setMessage("");
  }

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
    setConfirming(false);
  }

  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length || pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/original/drafts", jsonMutationRequest({
        method: "DELETE",
        body: JSON.stringify({ ids }),
      }));
      const result = await response.json() as { removed?: number; error?: string };
      const removed = Number(result.removed);
      if (!response.ok || !Number.isSafeInteger(removed) || removed < 1) {
        throw new Error(result.error || tr("删除失败，请重试"));
      }
      const removedIds = new Set(ids);
      setItems((current) => current.filter((item) => !removedIds.has(item.id)));
      setSelected(new Set());
      setConfirming(false);
      setMessage(`${tr("已删除")} ${removed} ${tr("篇草稿")}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr("删除失败，请重试"));
    } finally {
      setPending(false);
    }
  }

  if (!items.length && !message) return <p className="originalEmpty">{tr("暂无草稿")}</p>;

  return (
    <section className="originalDraftManager" aria-busy={pending}>
      <div className="selectionToolbar originalDraftToolbar">
        {managing && items.length ? (
          <SelectionCheckbox
            className="selectionSelectAll"
            checked={allSelected}
            disabled={pending}
            onChange={toggleAll}
            label={tr("选择当前页全部草稿")}
          >
            {tr("全选")}
          </SelectionCheckbox>
        ) : <span aria-hidden="true" />}
        <div className="selectionToolbarActions">
          {message ? <span className="selectionStatus" role="status">{message}</span> : null}
          {managing && selected.size ? (
            confirming ? (
              <span className="selectionConfirm">
                <span>{tr("删除所选")} {selected.size}？</span>
                <button className="isDanger" type="button" disabled={pending} onClick={() => void removeSelected()} aria-label={tr("确认删除")} title={tr("确认删除")}>
                  <Check size={15} aria-hidden="true" />
                </button>
                <button type="button" disabled={pending} onClick={() => setConfirming(false)} aria-label={tr("取消")} title={tr("取消")}>
                  <X size={15} aria-hidden="true" />
                </button>
              </span>
            ) : (
              <button className="selectionAction isDanger" type="button" disabled={pending} onClick={() => setConfirming(true)}>
                <Trash2 size={15} aria-hidden="true" />
                <span>{tr("删除所选")}（{selected.size}）</span>
              </button>
            )
          ) : null}
          {items.length ? (
            <button className={managing ? "selectionAction isActive" : "selectionAction"} type="button" disabled={pending} onClick={toggleManaging}>
              {managing ? <Check size={15} aria-hidden="true" /> : <ListChecks size={15} aria-hidden="true" />}
              <span>{tr(managing ? "完成" : "管理")}</span>
            </button>
          ) : null}
        </div>
      </div>
      {!items.length ? <p className="originalEmpty">{tr("暂无草稿")}</p> : <div className={managing ? "originalDraftList isManaging" : "originalDraftList"}>
        {items.map((draft) => {
          const title = draft.title || tr("无标题草稿");
          const isSelected = selected.has(draft.id);
          return (
            <article className={isSelected ? "originalDraftItem isSelected" : "originalDraftItem"} key={draft.id}>
              {managing ? (
                <SelectionCheckbox
                  className="selectionItemControl originalDraftSelect"
                  checked={isSelected}
                  disabled={pending}
                  onChange={() => toggle(draft.id)}
                  label={`${tr("选择")} ${title}`}
                />
              ) : null}
              <Link href={`/original/write/${draft.id}`} className="originalDraftRow" onClick={managing ? (event) => {
                event.preventDefault();
                toggle(draft.id);
              } : undefined}>
                <span><strong>{title}</strong><small>{draft.updatedLabel}</small></span>
                {!managing ? <span className="originalDraftEditAction">{tr("编辑")}</span> : null}
              </Link>
              {!managing ? <OriginalDraftDeleteButton draftId={draft.id} title={draft.title} locale={locale} /> : null}
            </article>
          );
        })}
      </div>}
    </section>
  );
}
