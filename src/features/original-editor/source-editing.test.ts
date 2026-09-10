import assert from "node:assert/strict";
import test from "node:test";
import { editMarkdownSource } from "./source-editing";

test("source underline uses an unambiguous marker instead of italic syntax", () => {
  const result = editMarkdownSource("下划线", 0, 3, "underline");
  assert.equal(result.value, "<u>下划线</u>");
  assert.deepEqual([result.start, result.end], [3, 6]);
  // Applying it again unwraps, so the button toggles rather than nesting markers.
  assert.equal(editMarkdownSource(result.value, 0, result.value.length, "underline").value, "下划线");
});

test("source clear strips inline markers and link targets but keeps images whole", () => {
  const result = editMarkdownSource("**粗**<u>下</u>[标签](https://a.cn)![图](/original/assets/1)", 0, 52, "clear");
  assert.equal(result.value, "粗下标签![图](/original/assets/1)");
});

test("source quote preserves selected line breaks and does not absorb the next paragraph", () => {
  const result = editMarkdownSource("第一行\n第二行\n下一段", 0, 8, "quote");
  assert.equal(result.value, "> 第一行\n> 第二行\n下一段");
  const restored = editMarkdownSource(result.value, result.start, result.end, "quote");
  assert.equal(restored.value, "第一行\n第二行\n下一段");
});

test("source divider is separated from surrounding prose by blank lines", () => {
  const result = editMarkdownSource("上文下文", 2, 2, "divider");
  assert.equal(result.value, "上文\n\n---\n\n下文");
});
