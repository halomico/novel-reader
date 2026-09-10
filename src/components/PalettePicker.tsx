"use client";

import { Dices } from "lucide-react";
import { COLOR_PALETTES, getColorPalette, type ColorPalette } from "@/lib/ui-preferences";
import { SelectControl } from "./SelectControl";

export function PaletteSwatches({ value }: { value: ColorPalette }) {
  const palette = getColorPalette(value);
  return (
    <span className="paletteSwatches" aria-hidden="true">
      <span style={{ backgroundColor: palette.lightAccent }} />
      <span style={{ backgroundColor: palette.darkAccent }} />
    </span>
  );
}

export function PalettePicker({
  value,
  name,
  className = "",
  ariaLabel = "配色风格",
  showRandom = true,
  onChange,
}: {
  value: ColorPalette;
  name?: string;
  className?: string;
  ariaLabel?: string;
  showRandom?: boolean;
  onChange: (value: ColorPalette) => void;
}) {
  function chooseRandom() {
    const choices = COLOR_PALETTES.filter((item) => item.value !== value);
    onChange(choices[Math.floor(Math.random() * choices.length)].value);
  }

  return (
    <div className={`palettePicker${className ? ` ${className}` : ""}`}>
      <PaletteSwatches value={value} />
      <SelectControl name={name} aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value as ColorPalette)}>
        {COLOR_PALETTES.map((item) => (
          <option value={item.value} key={item.value}>{item.label}</option>
        ))}
      </SelectControl>
      {showRandom ? (
        <button
          className="palettePickerRandom"
          type="button"
          onClick={chooseRandom}
          aria-label="随机选择配色"
          title="随机选择配色"
        >
          <Dices size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
