import assert from "node:assert/strict";
import test from "node:test";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  KEY_TAB_COMMAND,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { LinkNode } from "@lexical/link";
import { CodeNode, $createCodeNode } from "@lexical/code";
import { ListNode, ListItemNode } from "@lexical/list";
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellHeaderStates, TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { registerEditorTabIndentation } from "./EditorTabPlugin";
import { CHINESE_INDENT } from "./tab-indentation";

function createMockTabEvent(shiftKey = false): KeyboardEvent {
  let prevented = false;
  return {
    key: "Tab",
    shiftKey,
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as KeyboardEvent;
}

test("EditorTabPlugin: Tab inserts CHINESE_INDENT in paragraph and prevents default", () => {
  const editor = createEditor({
    namespace: "tab-test",
    nodes: [HeadingNode, QuoteNode, LinkNode, CodeNode, ListNode, ListItemNode],
    onError: (err) => {
      throw err;
    },
  });

  const unregister = registerEditorTabIndentation(editor);
  try {
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        root.append(p);
        const text = $createTextNode("正文内容");
        p.append(text);
        text.select(0, 0); // selection at start of text
      },
      { discrete: true },
    );

    const event = createMockTabEvent(false);
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(KEY_TAB_COMMAND, event);
      },
      { discrete: true },
    );

    assert.equal(handled, true);
    assert.equal(event.defaultPrevented, true);

    editor.getEditorState().read(() => {
      const root = $getRoot();
      assert.equal(root.getTextContent(), `${CHINESE_INDENT}正文内容`);
    });
  } finally {
    unregister();
  }
});

test("EditorTabPlugin: Shift+Tab outdents CHINESE_INDENT from paragraph", () => {
  const editor = createEditor({
    namespace: "tab-test-outdent",
    nodes: [HeadingNode, QuoteNode, LinkNode, CodeNode, ListNode, ListItemNode],
    onError: (err) => {
      throw err;
    },
  });

  const unregister = registerEditorTabIndentation(editor);
  try {
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        root.append(p);
        const text = $createTextNode(`${CHINESE_INDENT}正文内容`);
        p.append(text);
        text.select(2, 2); // selection after indent
      },
      { discrete: true },
    );

    const event = createMockTabEvent(true);
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(KEY_TAB_COMMAND, event);
      },
      { discrete: true },
    );

    assert.equal(handled, true);
    assert.equal(event.defaultPrevented, true);

    editor.getEditorState().read(() => {
      const root = $getRoot();
      assert.equal(root.getTextContent(), "正文内容");
    });
  } finally {
    unregister();
  }
});

test("EditorTabPlugin: Tab inserts 2 spaces inside code blocks", () => {
  const editor = createEditor({
    namespace: "tab-test-code",
    nodes: [HeadingNode, QuoteNode, LinkNode, CodeNode, ListNode, ListItemNode],
    onError: (err) => {
      throw err;
    },
  });

  const unregister = registerEditorTabIndentation(editor);
  try {
    editor.update(
      () => {
        const root = $getRoot();
        const code = $createCodeNode();
        root.append(code);
        const text = $createTextNode("const x = 1;");
        code.append(text);
        text.select(0, 0);
      },
      { discrete: true },
    );

    const event = createMockTabEvent(false);
    let handled = false;
    editor.update(
      () => {
        handled = editor.dispatchCommand(KEY_TAB_COMMAND, event);
      },
      { discrete: true },
    );

    assert.equal(handled, true);
    assert.equal(event.defaultPrevented, true);

    editor.getEditorState().read(() => {
      const root = $getRoot();
      assert.equal(root.getTextContent(), "  const x = 1;");
    });
  } finally {
    unregister();
  }
});

test("EditorTabPlugin: leaves Tab in a table cell for the table plugin", () => {
  const editor = createEditor({
    namespace: "tab-test-table",
    nodes: [HeadingNode, QuoteNode, LinkNode, CodeNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode],
    onError: (err) => {
      throw err;
    },
  });

  const unregister = registerEditorTabIndentation(editor);
  try {
    editor.update(() => {
      const root = $getRoot();
      const table = $createTableNode();
      const row = $createTableRowNode();
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      const paragraph = $createParagraphNode();
      const text = $createTextNode("表格内容");
      paragraph.append(text);
      cell.append(paragraph);
      row.append(cell);
      table.append(row);
      root.append(table);
      text.select(0, 0);
    }, { discrete: true });

    const event = createMockTabEvent();
    let handled = true;
    editor.update(() => {
      handled = editor.dispatchCommand(KEY_TAB_COMMAND, event);
    }, { discrete: true });

    assert.equal(handled, false);
    assert.equal(event.defaultPrevented, false);
  } finally {
    unregister();
  }
});
