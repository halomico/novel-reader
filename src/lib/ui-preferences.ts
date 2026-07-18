export const PALETTE_STORAGE_KEY = "novel-palette-v2";
export const READER_TAGS_STORAGE_KEY = "novel-reader-tags";
export const READER_HOTWORDS_STORAGE_KEY = "novel-reader-hotwords";
export const TOP_MENU_STORAGE_KEY = "novel-reader-top-menu";
export const ADMIN_SIDEBAR_STORAGE_KEY = "novel-reader-admin-sidebar-collapsed";

export const COLOR_PALETTES = [
  { value: "default", label: "Default", lightAccent: "#a42828", lightStrong: "#7c1e1e", lightTint: "#a42828", darkAccent: "#b65d2d", darkStrong: "#d1743e", darkTint: "#974b23" },
  { value: "spacelab", label: "Spacelab", lightAccent: "#446e9b", lightStrong: "#2f557d", lightTint: "#446e9b", darkAccent: "#5f7da0", darkStrong: "#7694b6", darkTint: "#496986" },
  { value: "nordic", label: "Nordic", lightAccent: "#3f6f78", lightStrong: "#2d555d", lightTint: "#3f6f78", darkAccent: "#65a0a8", darkStrong: "#82bbc2", darkTint: "#507f86" },
  { value: "flatly", label: "Flatly", lightAccent: "#25765d", lightStrong: "#185b46", lightTint: "#25765d", darkAccent: "#2c7e63", darkStrong: "#41977a", darkTint: "#246851" },
  { value: "sakura", label: "Sakura", lightAccent: "#a84f6d", lightStrong: "#843851", lightTint: "#a84f6d", darkAccent: "#b96882", darkStrong: "#d08098", darkTint: "#98556b" },
  { value: "cerulean", label: "Cerulean", lightAccent: "#1178a8", lightStrong: "#0b5b82", lightTint: "#1178a8", darkAccent: "#2586ae", darkStrong: "#3d9bc3", darkTint: "#1b6e91" },
  { value: "jade", label: "Jade", lightAccent: "#1f7a64", lightStrong: "#155b4a", lightTint: "#1f7a64", darkAccent: "#42a68b", darkStrong: "#61bea5", darkTint: "#348872" },
  { value: "minty", label: "Minty", lightAccent: "#2f7f72", lightStrong: "#206158", lightTint: "#2f7f72", darkAccent: "#3d8578", darkStrong: "#55a093", darkTint: "#326f64" },
  { value: "coral", label: "Coral", lightAccent: "#bd5146", lightStrong: "#913a33", lightTint: "#bd5146", darkAccent: "#c86a5f", darkStrong: "#e08479", darkTint: "#a6544c" },
  { value: "slate", label: "Slate", lightAccent: "#4f5964", lightStrong: "#39414a", lightTint: "#4f5964", darkAccent: "#65717d", darkStrong: "#7d8995", darkTint: "#525d68" },
  { value: "lavender", label: "Lavender", lightAccent: "#76539b", lightStrong: "#583c77", lightTint: "#76539b", darkAccent: "#9372b1", darkStrong: "#ae8dca", darkTint: "#785d92" },
  { value: "sandstone", label: "Sandstone", lightAccent: "#5f7725", lightStrong: "#46591a", lightTint: "#5f7725", darkAccent: "#718031", darkStrong: "#899943", darkTint: "#5e6c28" },
  { value: "graphite", label: "Graphite", lightAccent: "#4a555d", lightStrong: "#303940", lightTint: "#4a555d", darkAccent: "#7c8992", darkStrong: "#9aa5ad", darkTint: "#646f77" },
  { value: "pulse", label: "Pulse", lightAccent: "#6f42a8", lightStrong: "#52307f", lightTint: "#6f42a8", darkAccent: "#7850a0", darkStrong: "#9168b7", darkTint: "#634184" },
  { value: "amber", label: "Amber", lightAccent: "#a56512", lightStrong: "#7c4a09", lightTint: "#a56512", darkAccent: "#c48228", darkStrong: "#dda047", darkTint: "#9f691f" },
  { value: "materia", label: "Materia", lightAccent: "#8c3f72", lightStrong: "#6b2d56", lightTint: "#8c3f72", darkAccent: "#9a4e7c", darkStrong: "#b46696", darkTint: "#803f67" },
  { value: "arctic", label: "Arctic", lightAccent: "#28758d", lightStrong: "#1b596c", lightTint: "#28758d", darkAccent: "#4a91a8", darkStrong: "#68abc0", darkTint: "#3a778b" },
  { value: "superhero", label: "Superhero", lightAccent: "#344f72", lightStrong: "#253b57", lightTint: "#b76a2a", darkAccent: "#4b6480", darkStrong: "#667f9a", darkTint: "#a35d25" },
  { value: "ink", label: "Ink", lightAccent: "#35445a", lightStrong: "#263244", lightTint: "#35445a", darkAccent: "#6c7c93", darkStrong: "#8796aa", darkTint: "#566579" },
  { value: "cyborg", label: "Cyborg", lightAccent: "#756300", lightStrong: "#554800", lightTint: "#756300", darkAccent: "#9a8412", darkStrong: "#b8a02b", darkTint: "#7c6b0d" },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]["value"];
export type ColorPaletteOption = (typeof COLOR_PALETTES)[number];

export function isColorPalette(value: string | null | undefined): value is ColorPalette {
  return COLOR_PALETTES.some((palette) => palette.value === value);
}

export function getColorPalette(value: ColorPalette): ColorPaletteOption {
  return COLOR_PALETTES.find((palette) => palette.value === value) || COLOR_PALETTES[0];
}
