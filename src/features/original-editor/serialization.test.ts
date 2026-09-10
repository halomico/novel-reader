import assert from "node:assert/strict";
import test from "node:test";
import { countOriginalMarkdownCharacters, serializeOriginalEditorState } from "./serialization";

function state(children: unknown[]): string {
  return JSON.stringify({ root: { type: "root", version: 1, children } });
}

const text = (value: string, format = 0) => ({ type: "text", version: 1, text: value, format });
const paragraph = (value: string) => ({ type: "paragraph", version: 1, children: [text(value)] });

test("serializes one paid gate into isolated public and paid snapshots", () => {
  const result = serializeOriginalEditorState(state([
    { type: "original-heading", tag: "h1", anchorId: "heading_abcdefgh1234", children: [text("公开标题")] },
    paragraph("公开正文"),
    { type: "original-image", assetId: 7, altText: "公开图", caption: "说明", width: 800, height: 600 },
    { type: "paid-gate", version: 1 },
    { type: "original-heading", tag: "h2", anchorId: "heading_paid987654", children: [text("付费标题")] },
    paragraph("付费正文"),
    { type: "original-image", assetId: 8, altText: "付费图", caption: "", width: 900, height: 500 },
  ]));
  assert.match(result.publicMarkdown, /original-heading:heading_abcdefgh1234/u);
  assert.match(result.publicMarkdown, /\/original\/assets\/7/u);
  assert.doesNotMatch(result.publicMarkdown, /付费标题|\/original\/assets\/8/u);
  assert.match(result.paidMarkdown, /付费标题/u);
  assert.deepEqual(result.publicAssetIds, [7]);
  assert.deepEqual(result.paidAssetIds, [8]);
  assert.deepEqual(result.outline, [
    { id: "heading_abcdefgh1234", level: 1, text: "公开标题", paid: false },
    { id: "heading_paid987654", level: 2, text: "付费标题", paid: true },
  ]);
  assert.equal(result.paidGateCount, 1);
});

test("preserves code and link text without whole-document normalization", () => {
  const result = serializeOriginalEditorState(state([
    { type: "code", language: "ts", children: [text("const url = 'https://例子.test/Ａ';\n")] },
    { type: "paragraph", children: [{ type: "link", url: "https://example.com/%EF%BC%A1", children: [text("链接Ａ")] }] },
  ]));
  assert.match(result.publicMarkdown, /https:\/\/例子\.test\/Ａ/u);
  assert.match(result.publicMarkdown, /https:\/\/example\.com\/%EF%BC%A1/u);
  assert.match(result.publicMarkdown, /链接Ａ/u);
});

test("serializes full heading levels and GFM tables", () => {
  const result = serializeOriginalEditorState(state([
    { type: "original-heading", tag: "h3", anchorId: "heading_levelthree", children: [text("三级标题")] },
    {
      type: "table",
      children: [
        { type: "tablerow", children: [
          { type: "tablecell", children: [paragraph("名称")] },
          { type: "tablecell", children: [paragraph("数量")] },
        ] },
        { type: "tablerow", children: [
          { type: "tablecell", children: [paragraph("苹果")] },
          { type: "tablecell", children: [paragraph("3")] },
        ] },
      ],
    },
  ]));
  assert.match(result.publicMarkdown, /^### 三级标题/mu);
  assert.match(result.publicMarkdown, /^\| 名称 \| 数量 \|/mu);
  assert.match(result.publicMarkdown, /^\| 苹果 \| 3 \|/mu);
  assert.deepEqual(result.outline, [{ id: "heading_levelthree", level: 3, text: "三级标题", paid: false }]);
});

test("counts Markdown source text without syntax or task markers", () => {
  assert.equal(countOriginalMarkdownCharacters("### 标题\n\n- [x] 完成\n- [ ] 待办\n\n**加粗**"), 8);
});

test("underline is stored as <u>, the one representation that renders everywhere", () => {
  // format bits: 1 bold, 2 italic, 8 underline. `_x_` is emphasis and `__x__` is
  // strong in CommonMark, so neither may be redefined to mean underline.
  const result = serializeOriginalEditorState(state([
    { type: "paragraph", version: 1, children: [text("普通"), text("下划线", 8), text("粗下", 9)] },
  ]));
  assert.equal(result.publicMarkdown, "普通<u>下划线</u>**<u>粗下</u>**");
  // The tags are markup, not prose, so they must not inflate the word count.
  assert.equal(countOriginalMarkdownCharacters("普通<u>下划线</u>"), 5);
});

test("a copied heading cannot make two outline entries point at the same anchor", () => {
  const duplicate = { type: "original-heading", tag: "h1", anchorId: "heading_abcdefgh1234", children: [text("重复标题")] };
  const result = serializeOriginalEditorState(state([duplicate, duplicate]));
  const ids = result.outline.map((item) => item.id);
  assert.equal(new Set(ids).size, 2, `anchors collided: ${ids.join(", ")}`);
  assert.equal(ids[0], "heading_abcdefgh1234");
});

// Lexical stores inline content directly inside quotes and list items rather than
// wrapping it in a paragraph. Treating those children as blocks produced `- ` and `> `
// lines with nothing after them, so every list and every quotation was published empty.
test("lists and quotes keep their text, their nesting and their numbering", () => {
  const item = (value: string, extra: Record<string, unknown> = {}) => ({
    type: "listitem", version: 1, children: [text(value)], ...extra,
  });
  const result = serializeOriginalEditorState(state([
    { type: "quote", version: 1, children: [text("被引用的一句话。")] },
    {
      type: "list", version: 1, listType: "bullet", children: [
        item("要点一"),
        { type: "listitem", version: 1, children: [{ type: "list", version: 1, listType: "bullet", children: [item("子要点")] }] },
        item("要点二"),
      ],
    },
    {
      type: "list", version: 1, listType: "number", children: [
        item("第一步", { value: 1 }),
        item("第二步", { value: 2 }),
      ],
    },
  ]));
  assert.equal(result.publicMarkdown, [
    "> 被引用的一句话。",
    "",
    "- 要点一",
    "  - 子要点",
    "- 要点二",
    "",
    "1. 第一步",
    "2. 第二步",
  ].join("\n"));
});

test("inline formatting inside a list item survives publication", () => {
  const result = serializeOriginalEditorState(state([
    {
      type: "list", version: 1, listType: "bullet", children: [
        { type: "listitem", version: 1, children: [text("普通"), text("加粗", 1), { type: "link", version: 1, url: "/novels", children: [text("链接")] }] },
      ],
    },
  ]));
  assert.equal(result.publicMarkdown, "- 普通**加粗**[链接](/novels)");
});
