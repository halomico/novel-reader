import type { SelectHTMLAttributes } from "react";
import { SelectControl } from "./SelectControl";

export function AdminSelect({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <SelectControl wrapperClassName="adminSelectControl" className={className} {...props}>{children}</SelectControl>;
}
