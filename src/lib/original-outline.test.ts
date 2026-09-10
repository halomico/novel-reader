import assert from "node:assert/strict";
import test from "node:test";
import { joinOriginalBodies } from "./original-constants";
import { extractOriginalOutline, originalHeadingId, originalHeadingIdsByLine, scanOriginalHeadings } from "./original-outline";

test("headings resolve to the anchor the composer stored, not to their position", () => {
  const markdown = [
    "<!-- original-heading:heading_aaaaaaaaaaaa -->",
    "# 第一章 起风了",
    "",
    "正文。",
    "<!-- original-heading:heading_bbbbbbbbbbbb -->",
    "## 第一章 起风了",
    "",
    "更多正文。",
  ].join("\n");
  const outline = extractOriginalOutline(markdown);
  // Two headings with identical Chinese text still get distinct, stable targets —
  // which a slug of the title could not do, and a positional index would break the
  // moment a chapter was moved.
  assert.deepEqual(outline, [
    { id: "heading_aaaaaaaaaaaa", level: 1, text: "第一章 起风了" },
    { id: "heading_bbbbbbbbbbbb", level: 2, text: "第一章 起风了" },
  ]);
});

test("the renderer and the outline agree on the id for every heading line", () => {
  const markdown = "<!-- original-heading:heading_cccccccccccc -->\n# 标题\n\n正文\n\n## 无锚点标题";
  const byLine = originalHeadingIdsByLine(markdown);
  const hits = scanOriginalHeadings(markdown);
  for (const hit of hits) assert.equal(byLine.get(hit.line), hit.id);
  // A heading with no stored anchor still gets a deterministic fallback.
  assert.equal(hits[1].id, originalHeadingId(1));
});

test("a duplicated anchor is disambiguated instead of pointing two entries at one place", () => {
  const markdown = [
    "<!-- original-heading:heading_dddddddddddd -->",
    "# 甲",
    "",
    "<!-- original-heading:heading_dddddddddddd -->",
    "# 乙",
  ].join("\n");
  const ids = extractOriginalOutline(markdown).map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], "heading_dddddddddddd");
});

test("hashes inside fenced code are code, not chapters", () => {
  const markdown = "# 真标题\n\n```sh\n# 这是注释\n```\n\n## 另一个真标题";
  assert.deepEqual(extractOriginalOutline(markdown).map((item) => item.text), ["真标题", "另一个真标题"]);
});

test("outline text drops inline markup so the entry reads as a title", () => {
  const markdown = "# **粗体**与<u>下划线</u>和[链接](https://a.cn)";
  assert.equal(extractOriginalOutline(markdown)[0].text, "粗体与下划线和链接");
});

test("joining the public and paid halves keeps the paid section's heading anchors", () => {
  const publicBody = "<!-- original-heading:heading_eeeeeeeeeeee -->\n# 公开章\n\n公开正文。";
  const paidBody = "<!-- original-heading:heading_ffffffffffff -->\n## 付费章\n\n付费正文。";
  const outline = extractOriginalOutline(joinOriginalBodies(publicBody, paidBody));
  assert.deepEqual(outline.map((item) => item.id), ["heading_eeeeeeeeeeee", "heading_ffffffffffff"]);
  // Spacing the writer already provided is not doubled up.
  assert.equal(joinOriginalBodies("甲\n\n", "乙"), "甲\n\n乙");
  assert.equal(joinOriginalBodies("甲", "\n\n乙"), "甲\n\n乙");
  assert.equal(joinOriginalBodies("甲", ""), "甲");
});
