import assert from "node:assert/strict";
import test from "node:test";
import { editMarkdownSource } from "./source-editing";

test("source underline uses an unambiguous marker instead of italic syntax", () => {
  const result = editMarkdownSource("下划线", 0, 3, "underline");
  assert.equal(result.value, "==下划线==");
  assert.deepEqual([result.start, result.end], [2, 5]);
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
