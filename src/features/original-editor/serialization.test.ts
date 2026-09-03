import assert from "node:assert/strict";
import test from "node:test";
import { serializeOriginalEditorState } from "./serialization";

function state(children: unknown[]): string {
  return JSON.stringify({ root: { type: "root", version: 1, children } });
}

const text = (value: string, format = 0) => ({ type: "text", version: 1, text: value, format });
const paragraph = (value: string) => ({ type: "paragraph", version: 1, children: [text(value)] });

test("serializes one paid gate into isolated public and paid snapshots", () => {
  const result = serializeOriginalEditorState(state([
    { type: "original-heading", tag: "h2", anchorId: "heading_abcdefgh1234", children: [text("公开标题")] },
    paragraph("公开正文"),
    { type: "original-image", assetId: 7, altText: "公开图", caption: "说明", width: 800, height: 600 },
    { type: "paid-gate", version: 1 },
    { type: "original-heading", tag: "h3", anchorId: "heading_paid987654", children: [text("付费标题")] },
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
    { id: "heading_abcdefgh1234", level: 2, text: "公开标题", paid: false },
    { id: "heading_paid987654", level: 3, text: "付费标题", paid: true },
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
