import assert from "node:assert/strict";
import test from "node:test";
import { clearReaderPaperPreference } from "./reader-theme-client";
import {
  COLOR_PALETTES,
  DEFAULT_READER_LINE_HEIGHT,
  DEFAULT_READER_PAGE_TURN,
  DEFAULT_READER_WIDTH,
  getReaderThemeSystemTheme,
  getColorPalette,
  getColorPaletteFillTokens,
  FILLED_LABEL_COLOR,
  getColorPaletteTextTokens,
  isColorPalette,
  normalizeReaderLineHeight,
  normalizeReaderJustify,
  normalizeReaderPageTurn,
  normalizeReaderWidth,
  normalizeNovelCatalogSearchExpanded,
  normalizeReaderTagsMode,
  isReaderTheme,
  READER_THEME_OPTIONS,
  READER_LINE_HEIGHTS,
  READER_PAGE_TURN_OPTIONS,
  READER_WIDTHS,
  resolveDefaultPalette,
} from "./ui-preferences";
import { splitReaderParagraphs } from "./reader-layout";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => (
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test("ships the complete Bootswatch 5 palette set with Default first", () => {
  const values = COLOR_PALETTES.map((palette) => palette.value);

  assert.equal(COLOR_PALETTES.length, 27);
  assert.equal(new Set(values).size, 27);
  assert.equal(COLOR_PALETTES[0].value, "default");
  assert.equal(COLOR_PALETTES[0].label, "Default");
  assert.equal(getColorPalette("default").lightAccent, "#0d6efd");
  assert.equal(getColorPalette("default").darkAccent, "#6ea8fe");
  assert.equal(isColorPalette("journal"), true);
  assert.equal(isColorPalette("united"), true);
  assert.equal(isColorPalette("default"), true);
  assert.equal(getColorPalette("brite").lightAccent, "#a2e436");
  assert.equal(getColorPalette("minty").lightAccent, "#78c2ad");
  assert.equal(getColorPalette("vapor").darkAccent, "#a98eda");
  assert.equal(isColorPalette("cinnabar"), false);
  assert.equal(isColorPalette("catppuccin"), false);
  assert.equal(isColorPalette("unknown"), false);
});

test("keeps every palette's small-text accent at WCAG AA contrast on theme backgrounds and surfaces", () => {
  for (const palette of COLOR_PALETTES) {
    const tokens = getColorPaletteTextTokens(palette);
    assert.equal(
      Math.min(contrastRatio(tokens.lightText, "#f6f7f8"), contrastRatio(tokens.lightText, "#ffffff")) >= 4.5,
      true,
      `${palette.value} light text accent must reach 4.5:1`,
    );
    assert.equal(
      Math.min(contrastRatio(tokens.darkText, "#15191c"), contrastRatio(tokens.darkText, "#20262a")) >= 4.5,
      true,
      `${palette.value} dark text accent must reach 4.5:1`,
    );
  }
});

test("filled controls keep the official palette colour with a white label", () => {
  assert.equal(FILLED_LABEL_COLOR, "#ffffff");
  for (const palette of COLOR_PALETTES) {
    const fills = getColorPaletteFillTokens(palette);
    assert.equal(fills.lightFill, palette.lightAccent);
    assert.equal(fills.lightFillStrong, palette.lightAccent);
    assert.equal(fills.darkFill, palette.darkAccent);
    assert.equal(fills.darkFillStrong, palette.darkAccent);
  }
});

test("resolves a stable default palette for each configured time bucket", () => {
  const intervalMinutes = 60;
  const first = resolveDefaultPalette("default", true, intervalMinutes, 10 * 60 * 60_000);
  const sameBucket = resolveDefaultPalette("default", true, intervalMinutes, 10 * 60 * 60_000 + 59 * 60_000);
  const rotating = new Set(
    Array.from({ length: 40 }, (_, index) => resolveDefaultPalette("default", true, intervalMinutes, index * 60 * 60_000)),
  );

  assert.equal(first, sameBucket);
  assert.equal(rotating.size > 10, true);
  assert.equal(resolveDefaultPalette("journal", false, intervalMinutes, Date.now()), "journal");
});

test("normalizes current and legacy reader tag preferences", () => {
  assert.equal(normalizeReaderTagsMode("expanded"), "expanded");
  assert.equal(normalizeReaderTagsMode("collapsed"), "collapsed");
  assert.equal(normalizeReaderTagsMode("hidden"), "hidden");
  assert.equal(normalizeReaderTagsMode("hide"), "hidden");
  assert.equal(normalizeReaderTagsMode("show"), "expanded");
  assert.equal(normalizeReaderTagsMode(null), "collapsed");
  assert.equal(normalizeReaderTagsMode("unknown", "expanded"), "expanded");
});

test("provides 0.8 through 2.5 reader line heights in 0.1 steps", () => {
  assert.deepEqual(READER_LINE_HEIGHTS, [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5]);
  assert.equal(DEFAULT_READER_LINE_HEIGHT, 1.7);
  assert.equal(normalizeReaderLineHeight("0.8"), 0.8);
  assert.equal(normalizeReaderLineHeight("1.76"), 1.8);
  assert.equal(normalizeReaderLineHeight("2.2"), 2.2);
  assert.equal(normalizeReaderLineHeight("2.5"), 2.5);
  assert.equal(normalizeReaderLineHeight("invalid"), 1.7);
  assert.equal(normalizeReaderLineHeight("invalid", 1.4), 1.4);
});

test("keeps reader width and page-turn preferences within the supported lightweight options", () => {
  assert.deepEqual(READER_WIDTHS, ["auto", 640, 800, 900, 1000, 1280]);
  assert.equal(DEFAULT_READER_WIDTH, 800);
  assert.equal(DEFAULT_READER_PAGE_TURN, "scroll");
  assert.equal(normalizeReaderWidth("auto"), "auto");
  assert.equal(normalizeReaderWidth("1000"), 1000);
  assert.equal(normalizeReaderWidth("777"), 800);
  assert.deepEqual(READER_PAGE_TURN_OPTIONS.map((option) => option.value), ["scroll", "instant"]);
  // The retired translate mode keeps its readers on a paged layout.
  assert.equal(normalizeReaderPageTurn("slide"), "instant");
  assert.equal(normalizeReaderPageTurn("instant"), "instant");
  assert.equal(normalizeReaderPageTurn("unknown"), "scroll");
});

test("normalizes the first-paint reader justification preference", () => {
  assert.equal(normalizeReaderJustify("on"), true);
  assert.equal(normalizeReaderJustify("off"), false);
  assert.equal(normalizeReaderJustify(null), true);
  assert.equal(normalizeReaderJustify("unknown", false), false);
});

test("normalizes Chinese novel paragraphs while preserving a split segment continuation", () => {
  assert.deepEqual(
    splitReaderParagraphs("　第一段。\r\n\r\n  第二段。"),
    [
      { text: "第一段。", continued: false, sectionHeading: false },
      { text: "第二段。", continued: false, sectionHeading: false },
    ],
  );
  assert.deepEqual(
    splitReaderParagraphs("接续文字。\n下一段。", true),
    [
      { text: "接续文字。", continued: true, sectionHeading: false },
      { text: "下一段。", continued: false, sectionHeading: false },
    ],
  );
  assert.deepEqual(splitReaderParagraphs("序章\n第12章 风从海上来"), [
    { text: "序章", continued: false, sectionHeading: true },
    { text: "第12章 风从海上来", continued: false, sectionHeading: true },
  ]);
});

test("uses a browser catalog-search preference only when it is valid", () => {
  assert.equal(normalizeNovelCatalogSearchExpanded("expanded", false), true);
  assert.equal(normalizeNovelCatalogSearchExpanded("collapsed", true), false);
  assert.equal(normalizeNovelCatalogSearchExpanded("unknown", true), true);
  assert.equal(normalizeNovelCatalogSearchExpanded(null, false), false);
});

test("keeps the six measured reader paper themes in one shared preference model", () => {
  assert.deepEqual(
    READER_THEME_OPTIONS.map(({ value, paper, outer }) => ({ value, paper, outer })),
    [
      { value: "gray", paper: "#f5f5f5", outer: "#ebebeb" },
      { value: "warm", paper: "#f5f1e8", outer: "#ebe6da" },
      { value: "sepia", paper: "#efe2c0", outer: "#e3d0a1" },
      { value: "green", paper: "#e0eee1", outer: "#c9e0cb" },
      { value: "blue", paper: "#dcebef", outer: "#cedde1" },
      { value: "night", paper: "#111111", outer: "#0a0a0a" },
    ],
  );
  assert.equal(READER_THEME_OPTIONS.every((theme) => theme.swatch === theme.paper), true);
  assert.equal(isReaderTheme("night"), true);
  assert.equal(isReaderTheme("warm"), true);
  assert.equal(isReaderTheme("system"), false);
});

test("clears the selected reader paper when the system appearance changes", () => {
  const removedKeys: string[] = [];
  const removedAttributes: string[] = [];
  const shellAttributes: string[] = [];

  clearReaderPaperPreference({
    storage: { removeItem: (key) => removedKeys.push(key) },
    root: { removeAttribute: (name) => removedAttributes.push(name) },
    shells: [{ removeAttribute: (name) => shellAttributes.push(name) }],
  });

  assert.deepEqual(removedKeys, ["novel-reader-paper-v2"]);
  assert.deepEqual(removedAttributes, ["data-reader-theme"]);
  assert.deepEqual(shellAttributes, ["data-reader-theme"]);
});

test("maps reader papers to the matching global light or dark appearance", () => {
  assert.deepEqual(
    READER_THEME_OPTIONS.map((theme) => [theme.value, getReaderThemeSystemTheme(theme.value)]),
    [
      ["gray", "light"],
      ["warm", "light"],
      ["sepia", "light"],
      ["green", "light"],
      ["blue", "light"],
      ["night", "dark"],
    ],
  );
});
