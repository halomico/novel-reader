import assert from "node:assert/strict";
import test from "node:test";
import { applyTextareaIndent, applyTextareaOutdent, CHINESE_INDENT } from "./tab-indentation";

test("tab-indentation: single caret inserts CHINESE_INDENT and advances cursor", () => {
  const initial = "第一章 序幕\n天地初开";
  const caret = "第一章 序幕\n".length; // before 天地初开
  const result = applyTextareaIndent(initial, caret, caret);

  assert.equal(result.value, "第一章 序幕\n\u3000\u3000天地初开");
  assert.equal(result.selectionStart, caret + CHINESE_INDENT.length);
  assert.equal(result.selectionEnd, caret + CHINESE_INDENT.length);
});

test("tab-indentation: multi-line selection indents all lines across range", () => {
  const initial = "行一\n行二\n行三";
  const start = 1; // within 行一
  const end = 5; // within 行二
  const result = applyTextareaIndent(initial, start, end, "  ");

  assert.equal(result.value, "  行一\n  行二\n行三");
  assert.equal(result.selectionStart, start + 2);
  assert.equal(result.selectionEnd, end + 4);
});

test("tab-indentation: outdent removes Chinese indent and spaces cleanly", () => {
  const initial = "\u3000\u3000第一行\n    第二行\n无缩进第三行";
  const start = 2;
  const end = 12;

  const result = applyTextareaOutdent(initial, start, end);
  assert.equal(result.value, "第一行\n第二行\n无缩进第三行");
});
