"use client";

import { CheckSquare, Eye, EyeOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type BatchAction = (formData: FormData) => void | Promise<void>;

export type AdminBatchActionItem = {
  label: string;
  action: BatchAction;
  icon: "hide" | "publish" | "delete";
  tone?: "default" | "danger";
  confirmMessage?: string;
};

const ICONS = { hide: EyeOff, publish: Eye, delete: Trash2 } as const;

/** Select rows, then apply one of several batch actions to them. */
export function AdminOriginalBatchToolbar({
  formId,
  returnPath,
  actions,
  extraFields = {},
}: {
  formId: string;
  returnPath: string;
  actions: AdminBatchActionItem[];
  extraFields?: Record<string, string>;
}) {
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const update = (event?: Event) => {
      if (event?.target instanceof HTMLElement && !event.target.matches(`[data-batch-checkbox="${formId}"]`)) {
        return;
      }
      setSelected(document.querySelectorAll(`[data-batch-checkbox="${formId}"]:checked`).length);
    };
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, [formId]);

  function toggleAll() {
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-batch-checkbox="${formId}"]`));
    const next = boxes.some((box) => !box.checked);
    boxes.forEach((box) => { box.checked = next; box.dispatchEvent(new Event("change", { bubbles: true })); });
  }

  return (
    <div className="adminOriginalBatchToolbar">
      <button type="button" className="adminBatchSelectButton" onClick={toggleAll}><CheckSquare size={14} aria-hidden="true" />{selected ? `已选 ${selected}` : "全选"}</button>
      <form
        id={formId}
        action={actions[0]?.action}
        onSubmit={(event) => {
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          const message = submitter instanceof HTMLElement ? submitter.dataset.confirm : undefined;
          if (!selected || (message && !window.confirm(message))) event.preventDefault();
        }}
      >
        <input type="hidden" name="returnPath" value={returnPath} />
        {Object.entries(extraFields).map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}
        {actions.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <button
              type="submit"
              key={item.label}
              formAction={item.action}
              data-confirm={item.confirmMessage}
              className={item.tone === "danger" ? "adminBatchDeleteButton" : "adminBatchActionButton"}
              disabled={!selected}
            >
              <Icon size={14} aria-hidden="true" />{item.label}
            </button>
          );
        })}
      </form>
      <span>{selected ? `已选 ${selected}` : "选择后可批量处理"}</span>
    </div>
  );
}
