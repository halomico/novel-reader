import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

export function AdminSelect({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="adminSelectControl">
      <select className={className} {...props}>{children}</select>
      <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}
