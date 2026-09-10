"use client";

import { PalettePicker } from "@/components/PalettePicker";
import { type ColorPalette } from "@/lib/ui-preferences";
import { useState } from "react";

export function AdminPaletteField({ defaultValue }: { defaultValue: ColorPalette }) {
  const [value, setValue] = useState<ColorPalette>(defaultValue);

  return (
    <div className="adminPaletteField">
      <span>用户默认配色</span>
      <PalettePicker name="defaultPalette" value={value} onChange={setValue} />
      <small>仅在浏览器没有保存个人配色时生效。</small>
    </div>
  );
}
