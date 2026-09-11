export const PALETTE_STORAGE_KEY = "novel-palette-v2";
export const READER_TAGS_STORAGE_KEY = "novel-reader-tags";
export const READER_HOTWORDS_STORAGE_KEY = "novel-reader-hotwords";
export const READER_LINE_HEIGHT_STORAGE_KEY = "novel-reader-line-height";
export const READER_PAPER_STORAGE_KEY = "novel-reader-paper-v2";
export const READER_FONT_SIZE_STORAGE_KEY = "novel-font-size";
export const READER_WIDTH_STORAGE_KEY = "novel-reader-width";
export const READER_PAGE_TURN_STORAGE_KEY = "novel-reader-page-turn";
export const READER_JUSTIFY_STORAGE_KEY = "novel-reader-justify";
export const NOVEL_CATALOG_SEARCH_COOKIE = "novel-catalog-search";
export const UI_PREFERENCES_MIGRATION_KEY = "novel-ui-preferences-migration";
export const UI_PREFERENCES_MIGRATION_VERSION = "1";
export const LEGACY_UI_STORAGE_KEYS = [
  "novel-palette",
  "novel-page-size",
  "novel-ui-mode",
  "novel-reader-top-menu",
  "novel-reader-theme",
  "novel-reader-light-theme",
] as const;
export const ADMIN_SIDEBAR_STORAGE_KEY = "novel-reader-admin-sidebar-collapsed";
export const READER_LINE_HEIGHTS = [
  0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6,
  1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5,
] as const;
export const DEFAULT_READER_LINE_HEIGHT = 1.7;
export const DEFAULT_READER_WIDTH = 800;
export const READER_WIDTHS = ["auto", 640, 800, 900, 1000, 1280] as const;
export const READER_PAGE_TURN_OPTIONS = [
  { value: "scroll", label: "滚动" },
  { value: "slide", label: "平移" },
  { value: "instant", label: "无动画" },
] as const;
export const DEFAULT_READER_PAGE_TURN: ReaderPageTurn = "scroll";
export const READER_THEME_OPTIONS = [
  { value: "gray", label: "灰白", swatch: "#f5f5f5", paper: "#f5f5f5", outer: "#ebebeb" },
  { value: "warm", label: "暖白", swatch: "#f5f1e8", paper: "#f5f1e8", outer: "#ebe6da" },
  { value: "sepia", label: "米黄", swatch: "#efe2c0", paper: "#efe2c0", outer: "#e3d0a1" },
  { value: "green", label: "护眼", swatch: "#e0eee1", paper: "#e0eee1", outer: "#c9e0cb" },
  { value: "blue", label: "浅蓝", swatch: "#dcebef", paper: "#dcebef", outer: "#cedde1" },
  { value: "night", label: "夜间", swatch: "#111111", paper: "#111111", outer: "#0a0a0a" },
] as const;

export const COLOR_PALETTES = [
  // Bootswatch 5.3.8: Default plus all 26 official themes. Accents are each
  // theme's primary token; strong/light-on-dark values use Bootswatch's generated
  // primary emphasis and dark link-hover tokens so small themed text stays legible.
  { value: "default", label: "Default", lightAccent: "#0d6efd", lightStrong: "#052c65", darkAccent: "#6ea8fe", darkStrong: "#8bb9fe" },
  { value: "brite", label: "Brite", lightAccent: "#a2e436", lightStrong: "#415b16", darkAccent: "#c7ef86", darkStrong: "#d2f29e" },
  { value: "cerulean", label: "Cerulean", lightAccent: "#2fa4e7", lightStrong: "#13425c", darkAccent: "#82c8f1", darkStrong: "#9bd3f4" },
  { value: "cosmo", label: "Cosmo", lightAccent: "#2780e3", lightStrong: "#10335b", darkAccent: "#7db3ee", darkStrong: "#97c2f1" },
  { value: "cyborg", label: "Cyborg", lightAccent: "#2a9fd6", lightStrong: "#114056", darkAccent: "#7fc5e6", darkStrong: "#99d1eb" },
  { value: "darkly", label: "Darkly", lightAccent: "#375a7f", lightStrong: "#162433", darkAccent: "#879cb2", darkStrong: "#9fb0c1" },
  { value: "flatly", label: "Flatly", lightAccent: "#2c3e50", lightStrong: "#121920", darkAccent: "#808b96", darkStrong: "#99a2ab" },
  { value: "journal", label: "Journal", lightAccent: "#eb6864", lightStrong: "#5e2a28", darkAccent: "#f3a4a2", darkStrong: "#f5b6b5" },
  { value: "litera", label: "Litera", lightAccent: "#4582ec", lightStrong: "#1c345e", darkAccent: "#8fb4f4", darkStrong: "#a5c3f6" },
  { value: "lumen", label: "Lumen", lightAccent: "#158cba", lightStrong: "#08384a", darkAccent: "#73bad6", darkStrong: "#8fc8de" },
  { value: "lux", label: "Lux", lightAccent: "#1a1a1a", lightStrong: "#0a0a0a", darkAccent: "#767676", darkStrong: "#919191" },
  { value: "materia", label: "Materia", lightAccent: "#2196f3", lightStrong: "#0d3c61", darkAccent: "#7ac0f8", darkStrong: "#95cdf9" },
  { value: "minty", label: "Minty", lightAccent: "#78c2ad", lightStrong: "#304e45", darkAccent: "#aedace", darkStrong: "#bee1d8" },
  { value: "morph", label: "Morph", lightAccent: "#378dfc", lightStrong: "#163865", darkAccent: "#87bbfd", darkStrong: "#9fc9fd" },
  { value: "pulse", label: "Pulse", lightAccent: "#593196", lightStrong: "#24143c", darkAccent: "#9b83c0", darkStrong: "#af9ccd" },
  { value: "quartz", label: "Quartz", lightAccent: "#e83283", lightStrong: "#5d1434", darkAccent: "#f184b5", darkStrong: "#f49dc4" },
  { value: "sandstone", label: "Sandstone", lightAccent: "#325d88", lightStrong: "#142536", darkAccent: "#849eb8", darkStrong: "#9db1c6" },
  { value: "simplex", label: "Simplex", lightAccent: "#d9230f", lightStrong: "#570e06", darkAccent: "#e87b6f", darkStrong: "#ed958c" },
  { value: "sketchy", label: "Sketchy", lightAccent: "#333333", lightStrong: "#141414", darkAccent: "#858585", darkStrong: "#9d9d9d" },
  { value: "slate", label: "Slate", lightAccent: "#3a3f44", lightStrong: "#17191b", darkAccent: "#898c8f", darkStrong: "#a1a3a5" },
  { value: "solar", label: "Solar", lightAccent: "#b58900", lightStrong: "#483700", darkAccent: "#d3b866", darkStrong: "#dcc685" },
  { value: "spacelab", label: "Spacelab", lightAccent: "#446e9b", lightStrong: "#1b2c3e", darkAccent: "#8fa8c3", darkStrong: "#a5b9cf" },
  { value: "superhero", label: "Superhero", lightAccent: "#df6919", lightStrong: "#592a0a", darkAccent: "#eca575", darkStrong: "#f0b791" },
  { value: "united", label: "United", lightAccent: "#e95420", lightStrong: "#5d220d", darkAccent: "#f29879", darkStrong: "#f5ad94" },
  { value: "vapor", label: "Vapor", lightAccent: "#6f42c1", lightStrong: "#2c1a4d", darkAccent: "#a98eda", darkStrong: "#baa5e1" },
  { value: "yeti", label: "Yeti", lightAccent: "#008cba", lightStrong: "#00384a", darkAccent: "#66bad6", darkStrong: "#85c8de" },
  { value: "zephyr", label: "Zephyr", lightAccent: "#3459e6", lightStrong: "#15245c", darkAccent: "#859bf0", darkStrong: "#9daff3" },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]["value"];
export type ColorPaletteOption = (typeof COLOR_PALETTES)[number];

/** Label colour of every filled control (core.css `--accent-foreground`), in both themes. */
export const FILLED_LABEL_COLOR = "#ffffff";

export function getColorPaletteFillTokens(palette: ColorPaletteOption): {
  lightFill: string;
  lightFillStrong: string;
  darkFill: string;
  darkFillStrong: string;
} {
  // Keep Bootswatch's primary colours intact. Filled controls use a fixed white
  // foreground; controls provide their own lightweight hover feedback.
  return {
    lightFill: palette.lightAccent,
    lightFillStrong: palette.lightAccent,
    darkFill: palette.darkAccent,
    darkFillStrong: palette.darkAccent,
  };
}

/** Keep small-text accents independent from fill accents in every palette. */
export function getColorPaletteTextTokens(palette: ColorPaletteOption): {
  lightText: string;
  darkText: string;
} {
  return {
    lightText: palette.lightStrong,
    darkText: palette.darkStrong,
  };
}

export type ReaderTagsMode = "expanded" | "collapsed" | "hidden";
export type ReaderLineHeight = (typeof READER_LINE_HEIGHTS)[number];
export type ReaderWidth = (typeof READER_WIDTHS)[number];
export type ReaderPageTurn = (typeof READER_PAGE_TURN_OPTIONS)[number]["value"];
export type ReaderTheme = (typeof READER_THEME_OPTIONS)[number]["value"];
export type SystemTheme = "light" | "dark";

export function isReaderTheme(value: string | null | undefined): value is ReaderTheme {
  return READER_THEME_OPTIONS.some((theme) => theme.value === value);
}

export function getReaderThemeSystemTheme(theme: ReaderTheme): SystemTheme {
  return theme === "night" ? "dark" : "light";
}

export function normalizeReaderLineHeight(
  value: string | number | null | undefined,
  fallback: ReaderLineHeight = DEFAULT_READER_LINE_HEIGHT,
): ReaderLineHeight {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0.8 || numeric > 2.5) {
    return fallback;
  }
  return READER_LINE_HEIGHTS.reduce((nearest, item) => (
    Math.abs(item - numeric) < Math.abs(nearest - numeric) ? item : nearest
  ));
}

export function normalizeReaderWidth(
  value: string | number | null | undefined,
  fallback: ReaderWidth = DEFAULT_READER_WIDTH,
): ReaderWidth {
  if (value === "auto") return "auto";
  const numeric = Number(value);
  return READER_WIDTHS.includes(numeric as ReaderWidth) ? numeric as ReaderWidth : fallback;
}

export function normalizeReaderPageTurn(
  value: string | null | undefined,
  fallback: ReaderPageTurn = DEFAULT_READER_PAGE_TURN,
): ReaderPageTurn {
  return READER_PAGE_TURN_OPTIONS.some((option) => option.value === value)
    ? value as ReaderPageTurn
    : fallback;
}

export function normalizeReaderJustify(
  value: string | null | undefined,
  fallback = true,
): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  return fallback;
}

export function normalizeNovelCatalogSearchExpanded(
  value: string | null | undefined,
  fallback: boolean,
): boolean {
  if (value === "expanded") return true;
  if (value === "collapsed") return false;
  return fallback;
}

export function normalizeReaderTagsMode(
  value: string | null | undefined,
  fallback: ReaderTagsMode = "collapsed",
): ReaderTagsMode {
  if (value === "expanded" || value === "show") {
    return "expanded";
  }
  if (value === "collapsed") {
    return "collapsed";
  }
  if (value === "hidden" || value === "hide") {
    return "hidden";
  }
  return fallback;
}

export function isColorPalette(value: string | null | undefined): value is ColorPalette {
  return COLOR_PALETTES.some((palette) => palette.value === value);
}

export function getColorPalette(value: ColorPalette): ColorPaletteOption {
  return COLOR_PALETTES.find((palette) => palette.value === value) || COLOR_PALETTES[0];
}

function paletteIndexForBucket(bucket: number): number {
  let value = Math.floor(bucket) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) % COLOR_PALETTES.length;
}

export function resolveDefaultPalette(
  fallback: ColorPalette,
  randomEnabled: boolean,
  intervalMinutes: number,
  now = Date.now(),
): ColorPalette {
  if (!randomEnabled) {
    return fallback;
  }
  const intervalMs = Math.max(1, Math.floor(intervalMinutes)) * 60_000;
  return COLOR_PALETTES[paletteIndexForBucket(Math.floor(now / intervalMs))].value;
}
