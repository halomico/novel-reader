"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";

export function SelectionCheckbox({
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
  children,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <label className={`selectionCheckbox${className ? ` ${className}` : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
      <span className="selectionCheckboxIndicator" aria-hidden="true"><Check size={12} /></span>
      {children ? <em className="selectionCheckboxLabel">{children}</em> : null}
    </label>
  );
}
