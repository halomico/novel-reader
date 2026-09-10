import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function listCssFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listCssFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".css") ? [absolute] : [];
  });
}

test("uses the accessible text token instead of fill accents for CSS text color", () => {
  const appStyles = path.join(process.cwd(), "src", "app");
  for (const file of listCssFiles(appStyles)) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /(?:^|\n)\s*color:\s*var\(--accent(?:-strong)?\)(?:\s*!important)?;/u,
      `${path.relative(process.cwd(), file)} uses a fill accent as a text color`,
    );
  }
});
