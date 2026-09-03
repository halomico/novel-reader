import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

type SelectControlProps = SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
};

export function SelectControl({ wrapperClassName = "", className = "", children, ...props }: SelectControlProps) {
  return (
    <span className={`selectControl${wrapperClassName ? ` ${wrapperClassName}` : ""}`}>
      <select className={className} {...props}>{children}</select>
      <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}
