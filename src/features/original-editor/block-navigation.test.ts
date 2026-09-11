import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { $createListItemNode, $createListNode, $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { $createQuoteNode, QuoteNode } from "@lexical/rich-text";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  createEditor,
  DecoratorNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { registerBlockNavigation } = require("./plugins.tsx") as typeof import("./plugins");

class TestBlock extends DecoratorNode<null> {
  static getType() { return "test-block"; }
  static clone(node: TestBlock) { return new TestBlock(node.__key); }
  static importJSON() { return new TestBlock(); }
  createDOM() { return document.createElement("div"); }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  decorate() { return null; }
}

function keyEvent(overrides: Partial<KeyboardEvent> = {}) {
  let prevented = false;
  return {
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    preventDefault: () => { prevented = true; },
    get defaultPrevented() { return prevented; },
    ...overrides,
  } as unknown as KeyboardEvent;
}

function setup(onEdgeLine = true) {
  const editor = createEditor({
    namespace: "block-navigation-test",
    nodes: [ListNode, ListItemNode, QuoteNode, TestBlock],
    onError: (error) => { throw error; },
  });
  const unregister = registerBlockNavigation(editor, () => onEdgeLine, [TestBlock]);
  return { editor, unregister };
}

function press<T>(editor: LexicalEditor, command: LexicalCommand<T>, event: T): boolean {
  let handled = false;
  editor.update(() => { handled = editor.dispatchCommand(command, event); }, { discrete: true });
  return handled;
}

/** Top-level block types with their text, for readable assertions. */
function outline(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() => $getRoot().getChildren().map((node) => `${node.getType()}:${node.getTextContent()}`));
}

test("Enter leaves a list item that only looks empty because IME left a zero-width text node", () => {
  const { editor, unregister } = setup();
  try {
    editor.update(() => {
      const list = $createListNode("number");
      const first = $createListItemNode().append($createTextNode("第一项"));
      const ghost = $createTextNode("\u200b");
      const empty = $createListItemNode().append(ghost);
      list.append(first, empty);
      $getRoot().append(list);
      ghost.select(1, 1);
    }, { discrete: true });
    const event = keyEvent();
    assert.equal(press(editor, KEY_ENTER_COMMAND, event), true);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(outline(editor), ["list:第一项", "paragraph:"]);
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      assert.ok($isRangeSelection(selection));
      assert.ok($isParagraphNode(selection.anchor.getNode()));
    });
  } finally {
    unregister();
  }
});

test("Enter in a non-empty list item is left to the list plugin", () => {
  const { editor, unregister } = setup();
  try {
    editor.update(() => {
      const text = $createTextNode("内容");
      $getRoot().append($createListNode("bullet").append($createListItemNode().append(text)));
      text.select(2, 2);
    }, { discrete: true });
    assert.equal(press(editor, KEY_ENTER_COMMAND, keyEvent()), false);
  } finally {
    unregister();
  }
});

test("Backspace at the start of a middle list item splits the list around a paragraph", () => {
  const { editor, unregister } = setup();
  try {
    editor.update(() => {
      const middle = $createTextNode("二");
      $getRoot().append($createListNode("number").append(
        $createListItemNode().append($createTextNode("一")),
        $createListItemNode().append(middle),
        $createListItemNode().append($createTextNode("三")),
      ));
      middle.select(0, 0);
    }, { discrete: true });
    assert.equal(press(editor, KEY_BACKSPACE_COMMAND, keyEvent()), true);
    assert.deepEqual(outline(editor), ["list:一", "paragraph:二", "list:三"]);
    editor.getEditorState().read(() => {
      assert.ok($getRoot().getChildren().filter($isListNode).every((list) => list.getListType() === "number"));
    });
  } finally {
    unregister();
  }
});

test("Backspace after a block selects it first and removes it on the second press", () => {
  const { editor, unregister } = setup();
  try {
    editor.update(() => {
      const after = $createTextNode("付费正文");
      $getRoot().append(
        $createParagraphNode().append($createTextNode("公开正文")),
        new TestBlock(),
        $createParagraphNode().append(after),
      );
      after.select(0, 0);
    }, { discrete: true });

    assert.equal(press(editor, KEY_BACKSPACE_COMMAND, keyEvent()), true);
    assert.deepEqual(outline(editor), ["paragraph:公开正文", "test-block:", "paragraph:付费正文"]);
    editor.getEditorState().read(() => assert.ok($isNodeSelection($getSelection())));

    assert.equal(press(editor, KEY_BACKSPACE_COMMAND, keyEvent()), true);
    assert.deepEqual(outline(editor), ["paragraph:公开正文", "paragraph:付费正文"]);
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      assert.ok($isRangeSelection(selection) && selection.isCollapsed());
      assert.equal(selection.anchor.getNode().getTextContent(), "公开正文");
      assert.equal(selection.anchor.offset, 4);
    });
  } finally {
    unregister();
  }
});

test("Enter on a selected block opens a paragraph after it", () => {
  const { editor, unregister } = setup();
  try {
    editor.update(() => {
      const block = new TestBlock();
      $getRoot().append($createParagraphNode().append($createTextNode("前")), block, $createParagraphNode().append($createTextNode("后")));
      const selection = $createNodeSelection();
      selection.add(block.getKey());
      $setSelection(selection);
    }, { discrete: true });
    assert.equal(press(editor, KEY_ENTER_COMMAND, keyEvent()), true);
    assert.deepEqual(outline(editor), ["paragraph:前", "test-block:", "paragraph:", "paragraph:后"]);
  } finally {
    unregister();
  }
});

test("a block at the end of the document always has a paragraph after it", () => {
  const { editor, unregister } = setup();
  try {
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode("正文")), new TestBlock());
    }, { discrete: true });
    assert.deepEqual(outline(editor), ["paragraph:正文", "test-block:", "paragraph:"]);
    editor.update(() => { $getRoot().getLastChild()?.remove(); }, { discrete: true });
    assert.deepEqual(outline(editor), ["paragraph:正文", "test-block:", "paragraph:"]);
  } finally {
    unregister();
  }
});

test("ArrowUp and ArrowDown step over blocks from the edge line only", () => {
  const edge = setup(true);
  try {
    edge.editor.update(() => {
      const below = $createTextNode("下一段");
      $getRoot().append(
        $createParagraphNode().append($createTextNode("上一段")),
        new TestBlock(),
        new TestBlock(),
        $createParagraphNode().append(below),
      );
      below.select(2, 2);
    }, { discrete: true });
    assert.equal(press(edge.editor, KEY_ARROW_UP_COMMAND, keyEvent()), true);
    edge.editor.getEditorState().read(() => {
      const selection = $getSelection();
      assert.ok($isRangeSelection(selection));
      assert.equal(selection.anchor.getNode().getTextContent(), "上一段");
      assert.equal(selection.anchor.offset, 3);
    });
    assert.equal(press(edge.editor, KEY_ARROW_DOWN_COMMAND, keyEvent()), true);
    edge.editor.getEditorState().read(() => {
      const selection = $getSelection();
      assert.ok($isRangeSelection(selection));
      assert.equal(selection.anchor.getNode().getTextContent(), "下一段");
      assert.equal(selection.anchor.offset, 0);
    });
    assert.equal(press(edge.editor, KEY_ARROW_DOWN_COMMAND, keyEvent({ shiftKey: true })), false);
  } finally {
    edge.unregister();
  }

  const middle = setup(false);
  try {
    middle.editor.update(() => {
      const below = $createTextNode("很长的一段");
      $getRoot().append($createParagraphNode(), new TestBlock(), $createParagraphNode().append(below));
      below.select(3, 3);
    }, { discrete: true });
    assert.equal(press(middle.editor, KEY_ARROW_UP_COMMAND, keyEvent()), false, "a caret below the first line moves natively");
  } finally {
    middle.unregister();
  }
});

test("ArrowDown on the last line of a closing quote opens a paragraph after it", () => {
  const { editor, unregister } = setup();
  try {
    editor.update(() => {
      const text = $createTextNode("引文");
      $getRoot().append($createQuoteNode().append(text));
      text.select(2, 2);
    }, { discrete: true });
    assert.equal(press(editor, KEY_ARROW_DOWN_COMMAND, keyEvent()), true);
    assert.deepEqual(outline(editor), ["quote:引文", "paragraph:"]);
  } finally {
    unregister();
  }
});
