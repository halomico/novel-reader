import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { createEditor } from "lexical";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { ORIGINAL_MARKDOWN_TRANSFORMERS } = require("./markdown.ts") as typeof import("./markdown");

function createMarkdownEditor() {
  return createEditor({
    namespace: `original-markdown-test-${Math.random()}`,
    nodes: [HeadingNode, QuoteNode, LinkNode, CodeNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode, ...ORIGINAL_MARKDOWN_TRANSFORMERS.flatMap((transformer) => (
      transformer.type === "element" || transformer.type === "multiline-element" || transformer.type === "text-match"
        ? transformer.dependencies
        : []
    ))],
    onError(error) { throw error; },
  });
}

function importAndExport(markdown: string) {
  const editor = createMarkdownEditor();
  editor.update(() => {
    $convertFromMarkdownString(markdown, ORIGINAL_MARKDOWN_TRANSFORMERS);
  }, { discrete: true });
  let output = "";
  editor.getEditorState().read(() => {
    output = $convertToMarkdownString(ORIGINAL_MARKDOWN_TRANSFORMERS);
  });
  return { output, json: editor.getEditorState().toJSON() };
}

test("keeps Markdown heading levels through visual-editor conversion", () => {
  const result = importAndExport("### 三级标题\n\n###### 六级标题");
  const children = result.json.root.children;
  assert.deepEqual(children.map((node) => [node.type, "tag" in node ? node.tag : undefined]), [
    ["original-heading", "h3"],
    ["original-heading", "h6"],
  ]);
  assert.match(result.output, /^### 三级标题/mu);
  assert.match(result.output, /^###### 六级标题/mu);
});

test("does not expose internal heading anchors in the visual editor", () => {
  const result = importAndExport("<!-- original-heading:heading_legacy_0001 -->\n# 标题");
  assert.deepEqual(result.json.root.children.map((node) => node.type), ["original-heading"]);
  assert.match(result.output, /^# 标题/mu);
  assert.doesNotMatch(result.output, /original-heading/u);
});

test("keeps GFM tables through source and visual-editor conversion", () => {
  const result = importAndExport("| 名称 | 数量 |\n| --- | ---: |\n| 苹果 | 3 |\n| 香蕉 | 12 |");
  assert.equal(result.json.root.children[0]?.type, "table");
  assert.match(result.output, /^\| 名称 \| 数量 \|/mu);
  assert.match(result.output, /^\| --- \| --- \|/mu);
  assert.match(result.output, /^\| 苹果 \| 3 \|/mu);
});

test("keeps common GFM blocks together", () => {
  const result = importAndExport("> 引用\n\n- [x] 已完成\n- [ ] 待处理\n\n```ts\nconst answer = 42;\n```",
  );
  assert.deepEqual(result.json.root.children.map((node) => node.type), ["quote", "list", "code"]);
  const taskList = result.json.root.children[1] as unknown as {
    listType?: string;
    children?: Array<{ checked?: boolean }>;
  };
  assert.equal(taskList.listType, "check");
  assert.deepEqual(taskList.children?.map((node) => node.checked), [true, false]);
  assert.match(result.output, /> 引用/u);
  assert.match(result.output, /\[x\] 已完成/u);
  assert.match(result.output, /```ts/u);
});

test("keeps local Markdown images as visual image nodes", () => {
  const result = importAndExport("![封面](/original/assets/7 \"说明\")\n<!-- original-image-size:640x360 -->");
  assert.equal(result.json.root.children[0]?.type, "original-image");
  assert.match(result.output, /!\[封面\]\(\/original\/assets\/7/u);
  assert.match(result.output, /说明/u);
  assert.match(result.output, /original-image-size:640x360/u);
});

test("keeps inline underline syntax through visual-editor conversion", () => {
  const result = importAndExport("这是 ==重点== 文本");
  const paragraph = result.json.root.children[0] as unknown as { children?: Array<{ text?: string; format?: number }> };
  const underlined = paragraph.children?.find((child) => child.text === "重点");
  assert.equal(underlined?.format, 8);
  assert.match(result.output, /==重点==/u);
});
