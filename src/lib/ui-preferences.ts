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
  { value: "default", label: "GitHub", lightAccent: "#0969da", lightStrong: "#0550ae", darkAccent: "#4493f8", darkStrong: "#58a6ff" },
  { value: "spacelab", label: "Carbon", lightAccent: "#0f62fe", lightStrong: "#0043ce", darkAccent: "#78a9ff", darkStrong: "#78a9ff" },
  { value: "nordic", label: "Nightfox", lightAccent: "#2848a9", lightStrong: "#2848a9", darkAccent: "#719cd6", darkStrong: "#719cd6" },
  { value: "flatly", label: "Everforest", lightAccent: "#8da101", lightStrong: "#5c6a72", darkAccent: "#a7c080", darkStrong: "#a7c080" },
  { value: "sakura", label: "Catppuccin Pink", lightAccent: "#ea76cb", lightStrong: "#8839ef", darkAccent: "#f5c2e7", darkStrong: "#f5c2e7" },
  { value: "cerulean", label: "Tailwind Blue", lightAccent: "#1d4ed8", lightStrong: "#1d4ed8", darkAccent: "#60a5fa", darkStrong: "#60a5fa" },
  { value: "jade", label: "Vitesse", lightAccent: "#1c6b48", lightStrong: "#1c6b48", darkAccent: "#4d9375", darkStrong: "#4d9375" },
  { value: "minty", label: "Tailwind Teal", lightAccent: "#0f766e", lightStrong: "#0f766e", darkAccent: "#2dd4bf", darkStrong: "#2dd4bf" },
  { value: "coral", label: "Horizon", lightAccent: "#da103f", lightStrong: "#da103f", darkAccent: "#e95678", darkStrong: "#e95678" },
  { value: "slate", label: "Primer Gray", lightAccent: "#57606a", lightStrong: "#57606a", darkAccent: "#8b949e", darkStrong: "#c9d1d9" },
  { value: "lavender", label: "Catppuccin Mauve", lightAccent: "#8839ef", lightStrong: "#8839ef", darkAccent: "#cba6f7", darkStrong: "#cba6f7" },
  { value: "sandstone", label: "Tailwind Amber", lightAccent: "#b45309", lightStrong: "#b45309", darkAccent: "#fbbf24", darkStrong: "#fbbf24" },
  { value: "graphite", label: "Open Color Gray", lightAccent: "#343a40", lightStrong: "#343a40", darkAccent: "#adb5bd", darkStrong: "#adb5bd" },
  { value: "pulse", label: "One Dark", lightAccent: "#a626a4", lightStrong: "#a626a4", darkAccent: "#c678dd", darkStrong: "#c678dd" },
  { value: "amber", label: "Ayu", lightAccent: "#fa8d3e", lightStrong: "#5c6166", darkAccent: "#ff8f40", darkStrong: "#ff8f40" },
  { value: "materia", label: "Palenight", lightAccent: "#c792ea", lightStrong: "#676e95", darkAccent: "#c792ea", darkStrong: "#c792ea" },
  { value: "arctic", label: "Iceberg", lightAccent: "#2d539e", lightStrong: "#2d539e", darkAccent: "#84a0c6", darkStrong: "#84a0c6" },
  { value: "superhero", label: "Kanagawa", lightAccent: "#4d699b", lightStrong: "#4d699b", darkAccent: "#7e9cd8", darkStrong: "#7e9cd8" },
  { value: "ink", label: "Poimandres", lightAccent: "#42675a", lightStrong: "#42675a", darkAccent: "#5de4c7", darkStrong: "#5de4c7" },
  { value: "cyborg", label: "Monokai", lightAccent: "#f92672", lightStrong: "#75715e", darkAccent: "#f92672", darkStrong: "#f92672" },
  { value: "cinnabar", label: "Dracula", lightAccent: "#cb3a2a", lightStrong: "#cb3a2a", darkAccent: "#ff79c6", darkStrong: "#ff79c6" },
  { value: "nord", label: "Nord", lightAccent: "#5e81ac", lightStrong: "#4c566a", darkAccent: "#88c0d0", darkStrong: "#88c0d0" },
  { value: "tokyo", label: "Tokyo Night", lightAccent: "#2959aa", lightStrong: "#2959aa", darkAccent: "#7aa2f7", darkStrong: "#7aa2f7" },
  { value: "catppuccin", label: "Catppuccin", lightAccent: "#1e66f5", lightStrong: "#1e66f5", darkAccent: "#89b4fa", darkStrong: "#89b4fa" },
  { value: "gruvbox", label: "Gruvbox", lightAccent: "#af3a03", lightStrong: "#af3a03", darkAccent: "#fe8019", darkStrong: "#fe8019" },
  { value: "obsidian", label: "Primer Neutral", lightAccent: "#24292f", lightStrong: "#24292f", darkAccent: "#c9d1d9", darkStrong: "#c9d1d9" },
  { value: "forest", label: "Flexoki", lightAccent: "#66800b", lightStrong: "#536907", darkAccent: "#879a39", darkStrong: "#879a39" },
  { value: "rose", label: "Rosé Pine", lightAccent: "#b4637a", lightStrong: "#286983", darkAccent: "#eb6f92", darkStrong: "#eb6f92" },
  { value: "cyberpunk", label: "Synthwave '84", lightAccent: "#f92aad", lightStrong: "#495495", darkAccent: "#ff7edb", darkStrong: "#ff7edb" },
  { value: "solar-light", label: "Solarized Light", lightAccent: "#b58900", lightStrong: "#586e75", darkAccent: "#b58900", darkStrong: "#b58900" },
  { value: "solar-dark", label: "Solarized Dark", lightAccent: "#268bd2", lightStrong: "#586e75", darkAccent: "#268bd2", darkStrong: "#268bd2" },
  { value: "mintglass", label: "Open Color Teal", lightAccent: "#087f5b", lightStrong: "#087f5b", darkAccent: "#20c997", darkStrong: "#20c997" },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]["value"];
export type ColorPaletteOption = (typeof COLOR_PALETTES)[number];

const DARK_PALETTE_TEXT_OVERRIDES: Partial<Record<ColorPalette, string>> = {
  jade: "#80a665",
  coral: "#26bbd9",
  cyborg: "#66d9ef",
  "solar-dark": "#2aa198",
};

/** Keep small-text accents independent from fill accents in every palette. */
export function getColorPaletteTextTokens(palette: ColorPaletteOption): {
  lightText: string;
  darkText: string;
} {
  return {
    lightText: palette.lightStrong,
    darkText: DARK_PALETTE_TEXT_OVERRIDES[palette.value] ?? palette.darkStrong,
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
