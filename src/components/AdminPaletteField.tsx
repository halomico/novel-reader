"use client";

import { Dices } from "lucide-react";
import { useState } from "react";
import { AdminSelect } from "@/components/AdminSelect";
import { COLOR_PALETTES, type ColorPalette } from "@/lib/ui-preferences";

export function AdminPaletteField({ defaultValue }: { defaultValue: ColorPalette }) {
  const [value, setValue] = useState<ColorPalette>(defaultValue);

  function chooseRandomPalette() {
    const choices = COLOR_PALETTES.filter((palette) => palette.value !== value);
    const next = choices[Math.floor(Math.random() * choices.length)];
    setValue(next.value);
  }

  return (
    <div className="adminPaletteField">
      <span>用户默认配色</span>
      <div className="adminPaletteSelectRow">
        <AdminSelect name="defaultPalette" value={value} onChange={(event) => setValue(event.target.value as ColorPalette)}>
          {COLOR_PALETTES.map((palette) => (
            <option value={palette.value} key={palette.value}>{palette.label}</option>
          ))}
        </AdminSelect>
        <button
          className="adminPaletteDiceButton"
          type="button"
          onClick={chooseRandomPalette}
          aria-label="随机选择配色"
          title="随机选择配色"
        >
          <Dices size={17} aria-hidden="true" />
        </button>
      </div>
      <small>仅在浏览器没有保存个人配色时生效。</small>
    </div>
  );
}
