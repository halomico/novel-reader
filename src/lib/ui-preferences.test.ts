import assert from "node:assert/strict";
import test from "node:test";
import { COLOR_PALETTES, getColorPalette, isColorPalette } from "./ui-preferences";

test("ships 20 unique local palettes with Default first", () => {
  const values = COLOR_PALETTES.map((palette) => palette.value);

  assert.equal(COLOR_PALETTES.length, 20);
  assert.equal(new Set(values).size, 20);
  assert.equal(COLOR_PALETTES[0].value, "default");
  assert.equal(COLOR_PALETTES[0].label, "Default");
  assert.equal(getColorPalette("default").lightAccent, "#800020");
  assert.equal(getColorPalette("default").darkAccent, "#b9652a");
  assert.equal(isColorPalette("default"), true);
  assert.equal(isColorPalette("unknown"), false);
});
