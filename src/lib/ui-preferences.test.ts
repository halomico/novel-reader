import assert from "node:assert/strict";
import test from "node:test";
import {
  COLOR_PALETTES,
  DEFAULT_READER_LINE_HEIGHT,
  getColorPalette,
  isColorPalette,
  normalizeReaderLineHeight,
  normalizeReaderTagsMode,
  READER_LINE_HEIGHTS,
  resolveDefaultPalette,
} from "./ui-preferences";

test("ships 20 unique local palettes with Default first", () => {
  const values = COLOR_PALETTES.map((palette) => palette.value);

  assert.equal(COLOR_PALETTES.length, 20);
  assert.equal(new Set(values).size, 20);
  assert.equal(COLOR_PALETTES[0].value, "default");
  assert.equal(COLOR_PALETTES[0].label, "Default");
  assert.equal(getColorPalette("default").lightAccent, "#a42828");
  assert.equal(getColorPalette("default").darkAccent, "#b65d2d");
  assert.equal(isColorPalette("journal"), false);
  assert.equal(isColorPalette("united"), false);
  assert.equal(isColorPalette("default"), true);
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

test("provides seven practical reader line heights and migrates old loose values", () => {
  assert.deepEqual(READER_LINE_HEIGHTS, [1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2]);
  assert.equal(DEFAULT_READER_LINE_HEIGHT, 1.7);
  assert.equal(normalizeReaderLineHeight("1.4"), 1.4);
  assert.equal(normalizeReaderLineHeight("1.76"), 1.8);
  assert.equal(normalizeReaderLineHeight("2.2"), 2);
  assert.equal(normalizeReaderLineHeight("invalid"), 1.7);
  assert.equal(normalizeReaderLineHeight("invalid", 1.4), 1.4);
});
