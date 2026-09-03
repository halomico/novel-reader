"use client";

import { CheckSquare, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type BatchAction = (formData: FormData) => void | Promise<void>;

export function AdminOriginalBatchToolbar({
  formId,
  inputName,
  returnPath,
  action,
  label,
  confirmMessage,
  extraFields = {},
}: {
  formId: string;
  inputName: string;
  returnPath: string;
  action: BatchAction;
  label: string;
  confirmMessage: string;
  extraFields?: Record<string, string>;
}) {
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const update = () => setSelected(document.querySelectorAll(`[data-batch-checkbox="${formId}"]:checked`).length);
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
      <form id={formId} action={action} onSubmit={(event) => { if (!selected || !window.confirm(confirmMessage)) event.preventDefault(); }}>
        <input type="hidden" name="returnPath" value={returnPath} />
        {Object.entries(extraFields).map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}
        <button type="submit" className="adminBatchDeleteButton" disabled={!selected}><Trash2 size={14} aria-hidden="true" />{label}</button>
      </form>
      <span>{selected ? `已选 ${selected}` : "选择后可批量处理"}</span>
    </div>
  );
}
