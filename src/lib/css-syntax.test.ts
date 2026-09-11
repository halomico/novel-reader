import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";

const sourceRoot = path.resolve(process.cwd(), "src");

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(fullPath);
    return entry.name.endsWith(".css") ? [fullPath] : [];
  });
}

// Type checks and unit tests never parse stylesheets, so a malformed rule used to
// surface only as a 500 on every page. Every stylesheet must parse on its own.
test("every stylesheet parses", () => {
  const files = cssFiles(sourceRoot);
  assert.ok(files.length > 0, "no stylesheets found");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotThrow(() => postcss.parse(source, { from: file }), `${path.relative(sourceRoot, file)} does not parse`);
    // A replacement that forgot to expand its capture group leaves `$1` in a rule.
    assert.doesNotMatch(source, /\$\d/u, `${path.relative(sourceRoot, file)} contains an unexpanded replacement`);
  }
});
