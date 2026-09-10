import assert from "node:assert/strict";
import test from "node:test";
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, createEditor } from "lexical";
import { TRANSFORMERS } from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { ListNode, ListItemNode } from "@lexical/list";
import { registerBufferedMarkdown } from "./buffered-markdown";
import { editMarkdownSource } from "./source-editing";

async function fixture() {
  const editor = createEditor({ namespace: "buffer-check", nodes: [HeadingNode, QuoteNode, LinkNode, CodeNode, ListNode, ListItemNode], onError: error => { throw error; } });
  editor.update(() => { const p = $createParagraphNode(); $getRoot().append(p); p.append($createTextNode("")); p.selectEnd(); }, { discrete: true });
  const unregister = registerBufferedMarkdown(editor, TRANSFORMERS);
  async function type(value: string) {
    editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertText(value); }, { discrete: true });
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  const read = () => editor.getEditorState().toJSON().root.children;
  return { editor, type, read, unregister };
}

for (const [source, format] of [["**粗体**", 1], ["*斜体*", 2], ["***粗斜体***", 3], ["~~删除~~", 4], ["`code`", 16]] as const) {
  test(`${source} converts when the closing marker is complete`, async () => {
    const f = await fixture();
    try {
      for (const character of source) await f.type(character);
      f.editor.getEditorState().read(() => {
        const nodes = $getRoot().getAllTextNodes();
        assert.equal(nodes[0].getFormat(), format);
      });
      await f.type("后");
      f.editor.getEditorState().read(() => {
        const nodes = $getRoot().getAllTextNodes();
        assert.equal(nodes[0].getFormat(), format);
        assert.equal(nodes.at(-1)?.getTextContent(), "后");
        assert.equal(nodes.at(-1)?.getFormat(), 0);
      });
    } finally { f.unregister(); }
  });
}

test("links settle on the next character and preserve subsequent plain text", async () => {
  const f = await fixture();
  try {
    for (const character of "[网站](https://example.com)") await f.type(character);
    assert.match(JSON.stringify(f.read()), /"type":"link"/);
    await f.type("。");
    f.editor.getEditorState().read(() => {
      assert.match(JSON.stringify(f.read()), /"type":"link"/);
      assert.equal($getRoot().getTextContent(), "网站。");
    });
  } finally { f.unregister(); }
});

test("bulk input settles completed inline markers after trailing text", async () => {
  const f = await fixture();
  try {
    await f.type("**bold**x");
    f.editor.getEditorState().read(() => {
      const nodes = $getRoot().getAllTextNodes();
      assert.equal($getRoot().getTextContent(), "boldx");
      assert.equal(nodes[0].getFormat(), 1);
      assert.equal(nodes.at(-1)?.getTextContent(), "x");
    });
  } finally { f.unregister(); }
});

test("typing markers one at a time does not turn a partial bold marker into italic", async () => {
  const f = await fixture();
  try {
    for (const character of "**bold**") await f.type(character);
    await f.type("x");
    f.editor.getEditorState().read(() => {
      assert.equal($getRoot().getTextContent(), "boldx");
      assert.equal($getRoot().getAllTextNodes()[0].getFormat(), 1);
    });
  } finally { f.unregister(); }
});

test("escaped and unfinished markers remain literal", async () => {
  const f = await fixture();
  try {
    await f.type("\\**literal**");
    await f.type(" ");
    f.editor.getEditorState().read(() => assert.equal($getRoot().getTextContent(), "\\**literal** "));
  } finally { f.unregister(); }
});

test("heading converts only after entering the next paragraph and keeps the caret there", async () => {
  const f = await fixture();
  try {
    await f.type("# 第一章");
    assert.equal(f.read()[0].type, "paragraph");
    f.editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertParagraph(); }, { discrete: true });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.read()[0].type, "heading");
    await f.type("正文");
    f.editor.getEditorState().read(() => assert.equal($getRoot().getLastChild()?.getTextContent(), "正文"));
  } finally { f.unregister(); }
});

test("source toolbar wraps selected text, places the caret between markers and formats whole lines", () => {
  assert.deepEqual(editMarkdownSource("正文", 0, 2, "bold"), { value: "**正文**", start: 2, end: 4 });
  assert.deepEqual(editMarkdownSource("", 0, 0, "italic"), { value: "**", start: 1, end: 1 });
  assert.deepEqual(editMarkdownSource("const", 0, 5, "inlineCode"), { value: "`const`", start: 1, end: 6 });
  assert.equal(editMarkdownSource("第一行\n第二行", 5, 6, "h2").value, "第一行\n## 第二行");
  assert.equal(editMarkdownSource("第一行\n第二行", 0, 7, "unordered").value, "- 第一行\n- 第二行");
  assert.equal(editMarkdownSource("# 标题", 0, 4, "paragraph").value, "标题");
});
