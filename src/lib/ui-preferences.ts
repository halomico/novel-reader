export const PALETTE_STORAGE_KEY = "novel-palette-v2";
export const READER_TAGS_STORAGE_KEY = "novel-reader-tags";
export const READER_HOTWORDS_STORAGE_KEY = "novel-reader-hotwords";
export const TOP_MENU_STORAGE_KEY = "novel-reader-top-menu";
export const ADMIN_SIDEBAR_STORAGE_KEY = "novel-reader-admin-sidebar-collapsed";

export const COLOR_PALETTES = [
  { value: "default", label: "Default", lightAccent: "#a42828", lightStrong: "#7c1e1e", darkAccent: "#b65d2d", darkStrong: "#d1743e" },
  { value: "spacelab", label: "Spacelab", lightAccent: "#446e9b", lightStrong: "#2f557d", darkAccent: "#5f7da0", darkStrong: "#7694b6" },
  { value: "nordic", label: "Nordic", lightAccent: "#3f6f78", lightStrong: "#2d555d", darkAccent: "#65a0a8", darkStrong: "#82bbc2" },
  { value: "flatly", label: "Flatly", lightAccent: "#25765d", lightStrong: "#185b46", darkAccent: "#2c7e63", darkStrong: "#41977a" },
  { value: "sakura", label: "Sakura", lightAccent: "#a84f6d", lightStrong: "#843851", darkAccent: "#b96882", darkStrong: "#d08098" },
  { value: "cerulean", label: "Cerulean", lightAccent: "#1178a8", lightStrong: "#0b5b82", darkAccent: "#2586ae", darkStrong: "#3d9bc3" },
  { value: "jade", label: "Jade", lightAccent: "#1f7a64", lightStrong: "#155b4a", darkAccent: "#42a68b", darkStrong: "#61bea5" },
  { value: "minty", label: "Minty", lightAccent: "#2f7f72", lightStrong: "#206158", darkAccent: "#3d8578", darkStrong: "#55a093" },
  { value: "coral", label: "Coral", lightAccent: "#bd5146", lightStrong: "#913a33", darkAccent: "#c86a5f", darkStrong: "#e08479" },
  { value: "slate", label: "Slate", lightAccent: "#4f5964", lightStrong: "#39414a", darkAccent: "#65717d", darkStrong: "#7d8995" },
  { value: "lavender", label: "Lavender", lightAccent: "#76539b", lightStrong: "#583c77", darkAccent: "#9372b1", darkStrong: "#ae8dca" },
  { value: "sandstone", label: "Sandstone", lightAccent: "#5f7725", lightStrong: "#46591a", darkAccent: "#718031", darkStrong: "#899943" },
  { value: "graphite", label: "Graphite", lightAccent: "#4a555d", lightStrong: "#303940", darkAccent: "#7c8992", darkStrong: "#9aa5ad" },
  { value: "pulse", label: "Pulse", lightAccent: "#6f42a8", lightStrong: "#52307f", darkAccent: "#7850a0", darkStrong: "#a17cc4" },
  { value: "amber", label: "Amber", lightAccent: "#a56512", lightStrong: "#7c4a09", darkAccent: "#c48228", darkStrong: "#dda047" },
  { value: "materia", label: "Materia", lightAccent: "#8c3f72", lightStrong: "#6b2d56", darkAccent: "#9a4e7c", darkStrong: "#bd72a2" },
  { value: "arctic", label: "Arctic", lightAccent: "#28758d", lightStrong: "#1b596c", darkAccent: "#4a91a8", darkStrong: "#68abc0" },
  { value: "superhero", label: "Superhero", lightAccent: "#344f72", lightStrong: "#253b57", darkAccent: "#4b6480", darkStrong: "#718ca9" },
  { value: "ink", label: "Ink", lightAccent: "#35445a", lightStrong: "#263244", darkAccent: "#6c7c93", darkStrong: "#8796aa" },
  { value: "cyborg", label: "Cyborg", lightAccent: "#756300", lightStrong: "#554800", darkAccent: "#9a8412", darkStrong: "#b8a02b" },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]["value"];
export type ColorPaletteOption = (typeof COLOR_PALETTES)[number];
export type ReaderTagsMode = "expanded" | "collapsed" | "hidden";

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
