import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { originalTagSlug } from "@/lib/original-constants";

const composerCssRaw = readFileSync(
  fileURLToPath(new URL("./OriginalComposer.module.css", import.meta.url)),
  "utf8",
);

/** Declarations only, with newlines normalized: prose in comments must not satisfy or
 *  trip these guards, and a CRLF checkout must not change what the selectors match. */
const composerCss = composerCssRaw.replace(/\r\n/gu, "\n").replace(/\/\*[^]*?\*\//gu, " ");

function ruleBody(selector: string): string {
  const start = composerCss.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  const end = composerCss.indexOf("}", start);
  return composerCss.slice(start, end);
}

// A trailing space cannot be rendered under `white-space: normal`, so the browser
// stores U+00A0 in the contenteditable instead. Lexical reads that back into the
// model and every Markdown block shortcut — which tests for a literal U+0020 before
// the caret — silently stops firing, so "# ", "- ", "> " and "1. " never convert.
test("editor blocks keep the pre-wrap whitespace Lexical requires", () => {
  for (const selector of [".contentEditable", ".editorParagraph"]) {
    const body = ruleBody(selector);
    const whiteSpace = /white-space:\s*([a-z-]+)/u.exec(body)?.[1];
    if (selector === ".contentEditable") assert.equal(whiteSpace, "pre-wrap");
    else assert.notEqual(whiteSpace, "normal", `${selector} must not reset white-space to normal`);
  }
});

// Typing latency on a 200k-character manuscript is dominated by laying out the whole
// contenteditable on every keystroke. `contain: layout` isolates each block from its
// siblings and is safe. `content-visibility: auto` is ~2x faster again but defers
// layout for off-screen blocks, so a block created mid-edit is not laid out when
// Lexical maps the caret into it: the DOM selection desyncs and typed text lands at
// the wrong offset ("- a", Enter, "b" collapsed into one item reading "ba").
test("editor blocks contain their layout without deferring it", () => {
  assert.match(composerCss, /contain:\s*layout/u);
  assert.ok(!/content-visibility:\s*auto/u.test(composerCss),
    "content-visibility: auto desyncs the caret inside the contenteditable");
});
test("tag slugs keep Han characters instead of collapsing to the article fallback", () => {
  assert.equal(originalTagSlug("玄幻"), "玄幻");
  assert.equal(originalTagSlug("都市 生活"), "都市-生活");
  assert.equal(originalTagSlug("Fantasy"), "fantasy");
  assert.ok(!/^article-/u.test(originalTagSlug("感觉不够快")));
  // Distinct names must not collide on one slug, which is what the ASCII-only
  // article rule did by falling back to `article-<timestamp>` for every Han name.
  assert.notEqual(originalTagSlug("玄幻"), originalTagSlug("都市"));
  assert.equal(originalTagSlug("!!!"), "tag");
});

// A button the writer had just switched *off* still looked switched on the moment the
// pointer rested on it, because hover reused the active rule (with `!important`, so
// nothing could override it). Hover is an affordance; pressed is a state — and a pressed
// button keeps its accent under the pointer.
test("toolbar hover styling is distinct from the pressed state", () => {
  const hover = ruleBody(".toolbar button:hover:not(:disabled),\n.toolbar button:focus-visible");
  assert.doesNotMatch(hover, /--composer-accent/);
  assert.doesNotMatch(hover, /!important/);
  const active = ruleBody(".toolbar button.toolActive,\n.toolbar button.toolActive:hover:not(:disabled)");
  assert.match(active, /color: var\(--composer-accent\)/);
  assert.doesNotMatch(composerCss, /toolLocked|formatLockToggle/);
});

// The outline floats beside the sheet. It must never take layout space: opening it used
// to add a grid column that squeezed the page and pushed the text sideways.
test("the outline floats instead of reserving a column", () => {
  assert.match(ruleBody(".outline"), /position:\s*absolute/u);
  assert.match(ruleBody(".paper"), /margin:\s*0 auto/u);
  assert.doesNotMatch(composerCss, /grid-template-columns:\s*minmax\(0, 840px\)/u);
  assert.doesNotMatch(composerCss, /data-outline/u);
});

// Lexical renders a code block as <code>, an inline element. Left inline, its padding and
// background overlapped the lines above and below it.
test("code blocks are laid out as blocks", () => {
  assert.match(ruleBody(".editorCode"), /display:\s*block/u);
});
