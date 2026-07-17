export const PALETTE_STORAGE_KEY = "novel-palette-v2";
export const READER_TAGS_STORAGE_KEY = "novel-reader-tags";
export const READER_HOTWORDS_STORAGE_KEY = "novel-reader-hotwords";

export const COLOR_PALETTES = [
  { value: "default", label: "Default", lightAccent: "#b43b43", lightStrong: "#922f36", lightTint: "#b43b43", darkAccent: "#b9652a", darkStrong: "#d77b3d", darkTint: "#a95320" },
  { value: "spacelab", label: "Spacelab", lightAccent: "#446e9b", lightStrong: "#2f557d", lightTint: "#446e9b", darkAccent: "#5f7da0", darkStrong: "#7694b6", darkTint: "#496986" },
  { value: "cerulean", label: "Cerulean", lightAccent: "#1178a8", lightStrong: "#0b5b82", lightTint: "#1178a8", darkAccent: "#177ca7", darkStrong: "#2892be", darkTint: "#126789" },
  { value: "cosmo", label: "Cosmo", lightAccent: "#5a55b5", lightStrong: "#413d91", lightTint: "#5a55b5", darkAccent: "#7164ad", darkStrong: "#887bc2", darkTint: "#5c5192" },
  { value: "flatly", label: "Flatly", lightAccent: "#25765d", lightStrong: "#185b46", lightTint: "#25765d", darkAccent: "#2c7e63", darkStrong: "#41977a", darkTint: "#246851" },
  { value: "darkly", label: "Darkly", lightAccent: "#2f6f52", lightStrong: "#20523b", lightTint: "#2f6f52", darkAccent: "#3f7b5c", darkStrong: "#55936f", darkTint: "#34664c" },
  { value: "minty", label: "Minty", lightAccent: "#2f7f72", lightStrong: "#206158", lightTint: "#2f7f72", darkAccent: "#3d8578", darkStrong: "#55a093", darkTint: "#326f64" },
  { value: "sandstone", label: "Sandstone", lightAccent: "#5f7725", lightStrong: "#46591a", lightTint: "#5f7725", darkAccent: "#718031", darkStrong: "#899943", darkTint: "#5e6c28" },
  { value: "united", label: "United", lightAccent: "#c44118", lightStrong: "#963113", lightTint: "#c44118", darkAccent: "#b65d2d", darkStrong: "#d1743e", darkTint: "#974b23" },
  { value: "cyborg", label: "Cyborg", lightAccent: "#756300", lightStrong: "#554800", lightTint: "#756300", darkAccent: "#827000", darkStrong: "#9d890e", darkTint: "#6c5e00" },
  { value: "slate", label: "Slate", lightAccent: "#4f5964", lightStrong: "#39414a", lightTint: "#4f5964", darkAccent: "#65717d", darkStrong: "#7d8995", darkTint: "#525d68" },
  { value: "solar", label: "Solar", lightAccent: "#147a6f", lightStrong: "#0d5d54", lightTint: "#147a6f", darkAccent: "#278076", darkStrong: "#3b988d", darkTint: "#206a61" },
  { value: "litera", label: "Litera", lightAccent: "#8f3f50", lightStrong: "#6d2e3c", lightTint: "#8f3f50", darkAccent: "#9b5261", darkStrong: "#b56a79", darkTint: "#814450" },
  { value: "journal", label: "Journal", lightAccent: "#a42828", lightStrong: "#7c1e1e", lightTint: "#a42828", darkAccent: "#ad4b43", darkStrong: "#c7645b", darkTint: "#8e3c36" },
  { value: "materia", label: "Materia", lightAccent: "#8c3f72", lightStrong: "#6b2d56", lightTint: "#8c3f72", darkAccent: "#9a4e7c", darkStrong: "#b46696", darkTint: "#803f67" },
  { value: "pulse", label: "Pulse", lightAccent: "#6f42a8", lightStrong: "#52307f", lightTint: "#6f42a8", darkAccent: "#7850a0", darkStrong: "#9168b7", darkTint: "#634184" },
  { value: "quartz", label: "Quartz", lightAccent: "#a03979", lightStrong: "#7b2a5b", lightTint: "#a03979", darkAccent: "#9e4a7f", darkStrong: "#b96198", darkTint: "#833d69" },
  { value: "superhero", label: "Superhero", lightAccent: "#344f72", lightStrong: "#253b57", lightTint: "#b76a2a", darkAccent: "#4b6480", darkStrong: "#667f9a", darkTint: "#a35d25" },
  { value: "vapor", label: "Vapor", lightAccent: "#7b3eb4", lightStrong: "#5d2b8d", lightTint: "#b13a86", darkAccent: "#8b53ad", darkStrong: "#a66bc6", darkTint: "#8b3675" },
  { value: "sketchy", label: "Sketchy", lightAccent: "#30343b", lightStrong: "#1f2227", lightTint: "#69717b", darkAccent: "#666d76", darkStrong: "#818891", darkTint: "#555b63" },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]["value"];
export type ColorPaletteOption = (typeof COLOR_PALETTES)[number];

export function isColorPalette(value: string | null | undefined): value is ColorPalette {
  return COLOR_PALETTES.some((palette) => palette.value === value);
}

export function getColorPalette(value: ColorPalette): ColorPaletteOption {
  return COLOR_PALETTES.find((palette) => palette.value === value) || COLOR_PALETTES[0];
}
