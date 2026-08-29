import assert from "node:assert/strict";
import test from "node:test";
import { clearReaderPaperPreference } from "./reader-theme-client";
import {
  COLOR_PALETTES,
  DEFAULT_READER_LINE_HEIGHT,
  getReaderThemeSystemTheme,
  getColorPalette,
  isColorPalette,
  normalizeReaderLineHeight,
  normalizeNovelCatalogSearchExpanded,
  normalizeReaderTagsMode,
  isReaderTheme,
  READER_THEME_OPTIONS,
  READER_LINE_HEIGHTS,
  resolveDefaultPalette,
} from "./ui-preferences";

test("ships 21 unique local palettes with Default first and Cinnabar available", () => {
  const values = COLOR_PALETTES.map((palette) => palette.value);

  assert.equal(COLOR_PALETTES.length, 21);
  assert.equal(new Set(values).size, 21);
  assert.equal(COLOR_PALETTES[0].value, "default");
  assert.equal(COLOR_PALETTES[0].label, "Default");
  assert.equal(getColorPalette("default").lightAccent, "#9f3142");
  assert.equal(getColorPalette("default").darkAccent, "#b65d2d");
  assert.equal(isColorPalette("journal"), false);
  assert.equal(isColorPalette("united"), false);
  assert.equal(isColorPalette("default"), true);
  assert.equal(getColorPalette("cinnabar").lightAccent, "#e5353e");
  assert.equal(isColorPalette("unknown"), false);
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
  assert.equal(resolveDefaultPalette("sakura", false, intervalMinutes, Date.now()), "sakura");
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
