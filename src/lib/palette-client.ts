import {
  getColorPalette,
  getColorPaletteFillTokens,
  getColorPaletteTextTokens,
  type ColorPalette,
} from "@/lib/ui-preferences";

/** Every CSS custom property one colour palette defines, keyed by property name. */
export function colorPaletteProperties(value: ColorPalette): Record<string, string> {
  const palette = getColorPalette(value);
  const text = getColorPaletteTextTokens(palette);
  const fill = getColorPaletteFillTokens(palette);
  return {
    "--palette-light-accent": palette.lightAccent,
    "--palette-light-strong": palette.lightStrong,
    "--palette-dark-accent": palette.darkAccent,
    "--palette-dark-strong": palette.darkStrong,
    "--palette-light-text": text.lightText,
    "--palette-dark-text": text.darkText,
    "--palette-light-fill": fill.lightFill,
    "--palette-light-fill-strong": fill.lightFillStrong,
    "--palette-dark-fill": fill.darkFill,
    "--palette-dark-fill-strong": fill.darkFillStrong,
  };
}

/** Applies a palette to the document at runtime (settings picker, default rotation). */
export function applyColorPalette(value: ColorPalette): void {
  const root = document.documentElement;
  root.dataset.palette = value;
  for (const [property, color] of Object.entries(colorPaletteProperties(value))) {
    root.style.setProperty(property, color);
  }
}
