"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $createListNode, $handleListInsertParagraph, $isListItemNode, $isListNode } from "@lexical/list";
import { $isTableNode } from "@lexical/table";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  $createNodeSelection,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type ElementNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
} from "lexical";
import { ORIGINAL_MARKDOWN_TRANSFORMERS } from "./markdown";
import { $escapeCurrentBlock } from "./editor-commands";
import { DividerNode } from "./nodes/DividerNode";
import { OriginalImageNode } from "./nodes/OriginalImageNode";
import { $isPaidGateNode, PaidGateNode } from "./nodes/PaidGateNode";

/**
 * Live Markdown shortcuts.
 *
 * This deliberately hands the whole dialect to Lexical's own shortcut engine rather
 * than re-implementing it. The previous "buffered" implementation registered a second
 * scanner that called `editor.update()` from inside an update listener; Lexical then
 * merged the following keystrokes into that tagged update, so the built-in engine saw
 * the caret jump two offsets at once and skipped the transform. That is why `- `, `> `
 * and `# ` only ever converted one block *late*, and why a list never continued past
 * its first item.
 */
export function OriginalMarkdownPlugin() {
  return <MarkdownShortcutPlugin transformers={ORIGINAL_MARKDOWN_TRANSFORMERS} />;
}

/** Blocks that hold no text: the paid boundary, scene breaks and images. */
export function $isBlockDecorator(node: LexicalNode | null | undefined): node is LexicalNode {
  return $isDecoratorNode(node) && !node.isInline();
}

function $selectBlock(node: LexicalNode): void {
  const selection = $createNodeSelection();
  selection.add(node.getKey());
  $setSelection(selection);
}

/** The first text block past a run of decorator blocks, created when there is none —
 *  the caret must always have somewhere to land. */
function $textBlockBeyond(decorator: LexicalNode, up: boolean): ElementNode {
  let edge = decorator;
  for (;;) {
    const next = up ? edge.getPreviousSibling() : edge.getNextSibling();
    if (!$isBlockDecorator(next)) break;
    edge = next;
  }
  const beyond = up ? edge.getPreviousSibling() : edge.getNextSibling();
  if ($isElementNode(beyond)) return beyond;
  const paragraph = $createParagraphNode();
  if (up) edge.insertBefore(paragraph); else edge.insertAfter(paragraph);
  return paragraph;
}

function $isAtStartOf(selection: RangeSelection, block: ElementNode): boolean {
  if (!selection.isCollapsed() || selection.anchor.offset !== 0) return false;
  for (let node: LexicalNode | null = selection.anchor.getNode(); node && !node.is(block); node = node.getParent()) {
    if (node.getPreviousSibling()) return false;
  }
  return true;
}

function $isAtEndOf(selection: RangeSelection, block: ElementNode): boolean {
  if (!selection.isCollapsed()) return false;
  const node = selection.anchor.getNode();
  const size = $isTextNode(node) ? node.getTextContentSize() : $isElementNode(node) ? node.getChildrenSize() : 0;
  if (selection.anchor.offset !== size) return false;
  for (let current: LexicalNode | null = node; current && !current.is(block); current = current.getParent()) {
    if (current.getNextSibling()) return false;
  }
  return true;
}

const INVISIBLE_CHARACTERS = /[\s\u200b\u00a0\ufeff]/gu;

/**
 * Enter in an empty list item leaves the list (or outdents one level when nested).
 *
 * Lexical only does this when the item has *no children at all*. An item that looks
 * empty often is not: IME composition leaves a zero-width or empty text node behind,
 * and so does a format toggled on an empty line. Enter then kept producing new empty
 * items and the list could only be left with Ctrl+Enter.
 */
export function $exitEmptyListItem(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const item = $findMatchingParent(selection.anchor.getNode(), $isListItemNode);
  if (!$isListItemNode(item)) return false;
  if (!item.getChildren().every((child) => $isTextNode(child) || $isLineBreakNode(child))) return false;
  if (item.getTextContent().replace(INVISIBLE_CHARACTERS, "")) return false;
  item.clear();
  item.select(0, 0);
  return $handleListInsertParagraph();
}

/** Backspace at the very start of a top-level list item turns that item back into a
 *  paragraph, splitting the list around it — never merging it into the line above. */
export function $listItemToParagraph(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const item = $findMatchingParent(selection.anchor.getNode(), $isListItemNode);
  const list = item?.getParent();
  if (!$isListItemNode(item) || !$isListNode(list) || !$isRootNode(list.getParent())) return false;
  if (item.getChildren().some($isListNode) || !$isAtStartOf(selection, item)) return false;
  const paragraph = $createParagraphNode();
  paragraph.append(...item.getChildren());
  const following = item.getNextSiblings();
  if (!item.getPreviousSibling()) {
    list.insertBefore(paragraph);
  } else {
    list.insertAfter(paragraph);
    if (following.length) {
      const tail = $createListNode(list.getListType());
      tail.append(...following);
      paragraph.insertAfter(tail);
    }
  }
  item.remove();
  if (list.isEmpty()) list.remove();
  paragraph.selectStart();
  return true;
}

/** Remove a selected decorator block and put the caret into the neighbouring text. */
function $removeSelectedBlocks(backward: boolean): boolean {
  const selection = $getSelection();
  if (!$isNodeSelection(selection)) return false;
  const blocks = selection.getNodes().filter($isBlockDecorator);
  if (!blocks.length) return false;
  const before = blocks[0].getPreviousSibling();
  const after = blocks[blocks.length - 1].getNextSibling();
  blocks.forEach((block) => block.remove());
  const target = backward ? before || after : after || before;
  if ($isElementNode(target)) {
    if (target === before) target.selectEnd(); else target.selectStart();
  } else if (target) {
    $selectBlock(target);
  } else {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    paragraph.select();
  }
  return true;
}

/** Whether the caret sits on the first (`up`) or last visual line of the block. */
export type CaretLineProbe = (editor: LexicalEditor, blockKey: NodeKey, up: boolean) => boolean;

export const domCaretOnEdgeLine: CaretLineProbe = (editor, blockKey, up) => {
  const element = editor.getElementByKey(blockKey);
  const selection = element?.ownerDocument.defaultView?.getSelection();
  if (!element || !selection || selection.rangeCount === 0) return true;
  const caret = selection.getRangeAt(0).getClientRects()[0];
  // An empty line reports no caret box, and an empty block is exactly one line.
  if (!caret) return true;
  const contents = element.ownerDocument.createRange();
  contents.selectNodeContents(element);
  let top = Infinity;
  let bottom = -Infinity;
  for (const rect of contents.getClientRects()) {
    if (!rect.height) continue;
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(top)) return true;
  const tolerance = caret.height / 2;
  return up ? caret.top - top < tolerance : bottom - caret.bottom < tolerance;
};

const DEFAULT_BLOCK_DECORATORS: readonly Klass<LexicalNode>[] = [PaidGateNode, DividerNode, OriginalImageNode];

/**
 * Keyboard and pointer behaviour around block structure.
 *
 * - ArrowUp/ArrowDown step over non-text blocks. The browser cannot move a caret
 *   through `contenteditable="false"` content, and Lexical only intervenes when the
 *   caret is at offset 0, so from anywhere else on the line the caret simply stuck.
 * - A trailing non-text block always has a paragraph after it, and ArrowDown past the
 *   last list/quote/code block opens one, so there is always a place to keep writing.
 * - Backspace/Delete next to a non-text block first *selects* it; the second press
 *   removes it. Lexical deleted the paid boundary on the first press, silently.
 * - Enter leaves an empty list item; Ctrl/⌘+Enter leaves any block; ``` + Enter opens a
 *   code block; Enter on a selected block opens a paragraph after it.
 * - A click in the empty space below the last block puts the caret at the end.
 */
export function registerBlockNavigation(
  editor: LexicalEditor,
  caretOnEdgeLine: CaretLineProbe = domCaretOnEdgeLine,
  blockDecorators: readonly Klass<LexicalNode>[] = DEFAULT_BLOCK_DECORATORS,
): () => void {
  const arrow = (up: boolean) => (event: KeyboardEvent | null) => {
    if (event && (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)) return false;
    const selection = $getSelection();
    if ($isNodeSelection(selection)) {
      const block = selection.getNodes().find($isBlockDecorator);
      if (!block) return false;
      const target = $textBlockBeyond(block, up);
      if (up) target.selectEnd(); else target.selectStart();
      event?.preventDefault();
      return true;
    }
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
    const block = selection.focus.getNode().getTopLevelElement();
    if (!block) return false;
    const neighbour = up ? block.getPreviousSibling() : block.getNextSibling();
    const leavingLastBlock = !up && !neighbour && !$isParagraphNode(block);
    if (!$isBlockDecorator(neighbour) && !leavingLastBlock) return false;
    if (!caretOnEdgeLine(editor, block.getKey(), up)) return false;
    if (neighbour) {
      const target = $textBlockBeyond(neighbour, up);
      if (up) target.selectEnd(); else target.selectStart();
    } else {
      const paragraph = $createParagraphNode();
      block.insertAfter(paragraph);
      paragraph.select();
    }
    event?.preventDefault();
    return true;
  };

  const removeCommands = mergeRegister(
    editor.registerCommand<KeyboardEvent | null>(KEY_ENTER_COMMAND, (event) => {
      const selection = $getSelection();
      if ($isNodeSelection(selection)) {
        const block = selection.getNodes().find($isBlockDecorator);
        if (!block) return false;
        const paragraph = $createParagraphNode();
        block.insertAfter(paragraph);
        paragraph.select();
        event?.preventDefault();
        return true;
      }
      if (event && (event.shiftKey || event.altKey)) return false;
      if (event && (event.ctrlKey || event.metaKey)) {
        const escaped = $escapeCurrentBlock();
        if (escaped) event.preventDefault();
        return escaped;
      }
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      if ($exitEmptyListItem()) {
        event?.preventDefault();
        return true;
      }
      // Lexical's fenced-code shortcut fires on ``` followed by a space. Everyone types
      // ``` and presses Enter, so that path is wired up too.
      const block = selection.anchor.getNode().getTopLevelElement();
      if (!$isParagraphNode(block)) return false;
      const fence = /^\s*(?:```|~~~)([A-Za-z0-9+#-]{0,24})$/u.exec(block.getTextContent());
      if (!fence) return false;
      const code = $createCodeNode(fence[1] || undefined);
      block.replace(code);
      code.select();
      event?.preventDefault();
      return true;
    }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand<KeyboardEvent>(KEY_BACKSPACE_COMMAND, (event) => {
      if ($removeSelectedBlocks(true) || $listItemToParagraph()) {
        event.preventDefault();
        return true;
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const block = selection.anchor.getNode().getTopLevelElement();
      const previous = block?.getPreviousSibling();
      if (!block || !$isBlockDecorator(previous) || !$isAtStartOf(selection, block)) return false;
      // An empty line between two blocks is simply removed, as it would be anywhere else.
      if ($isParagraphNode(block) && block.getTextContentSize() === 0 && block.getNextSibling()) block.remove();
      $selectBlock(previous);
      event.preventDefault();
      return true;
    }, COMMAND_PRIORITY_LOW),
    editor.registerCommand<KeyboardEvent>(KEY_DELETE_COMMAND, (event) => {
      if ($removeSelectedBlocks(false)) {
        event.preventDefault();
        return true;
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const block = selection.anchor.getNode().getTopLevelElement();
      const next = block?.getNextSibling();
      if (!block || !$isBlockDecorator(next) || !$isAtEndOf(selection, block)) return false;
      if ($isParagraphNode(block) && block.getTextContentSize() === 0) block.remove();
      $selectBlock(next);
      event.preventDefault();
      return true;
    }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(KEY_ARROW_UP_COMMAND, arrow(true), COMMAND_PRIORITY_LOW),
    editor.registerCommand(KEY_ARROW_DOWN_COMMAND, arrow(false), COMMAND_PRIORITY_LOW),
    ...blockDecorators.map((klass) => editor.registerNodeTransform(klass, (node) => {
      if ($isRootNode(node.getParent()) && !node.getNextSibling()) node.insertAfter($createParagraphNode());
    })),
  );

  let root: HTMLElement | null = null;
  const onMouseDown = (event: MouseEvent) => {
    if (!root || event.button !== 0 || event.target !== root || !editor.isEditable()) return;
    const last = root.lastElementChild;
    if (last && event.clientY <= last.getBoundingClientRect().bottom) return;
    event.preventDefault();
    editor.update(() => {
      const tail = $getRoot().getLastChild();
      if ($isElementNode(tail) && !$isCodeNode(tail) && !$isTableNode(tail)) {
        tail.selectEnd();
        return;
      }
      const paragraph = $createParagraphNode();
      $getRoot().append(paragraph);
      paragraph.select();
    });
    root.focus({ preventScroll: true });
  };
  const removeRootListener = editor.registerRootListener((next, previous) => {
    previous?.removeEventListener("mousedown", onMouseDown);
    next?.addEventListener("mousedown", onMouseDown);
    root = next;
  });

  return () => {
    removeCommands();
    removeRootListener();
    root?.removeEventListener("mousedown", onMouseDown);
    root = null;
  };
}

export function BlockNavigationPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerBlockNavigation(editor), [editor]);
  return null;
}

const MARKDOWN_PASTE_PATTERN = /(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s|!\[[^\]\n]*\]\(|```|~~~|---\s*$)|(?:^|\n)\s*\|[^\n]+\|\s*\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?|(?:\*\*|__|~~|==|<u>|`|!?\[[^\]\n]+\]\()/u;

/** Plain text that is clearly Markdown becomes structure; anything else keeps
 *  Lexical's default paste handling, which already strips unsafe rich text. */
export function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData;
      const text = clipboard?.getData("text/plain") || "";
      if (!text || !MARKDOWN_PASTE_PATTERN.test(text)) return false;
      const hasRangeSelection = editor.getEditorState().read(() => $isRangeSelection($getSelection()));
      if (!hasRangeSelection) return false;
      (event as ClipboardEvent).preventDefault();
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const holder = $createParagraphNode();
        $convertFromMarkdownString(text, ORIGINAL_MARKDOWN_TRANSFORMERS, holder);
        const nodes = holder.getChildren();
        // A pasted document must never smuggle in a second paid boundary.
        const alreadyPaid = $getRoot().getChildren().some($isPaidGateNode);
        const safe = nodes.filter((node) => !($isPaidGateNode(node) && alreadyPaid));
        if (safe.length) selection.insertNodes(safe);
      }, { tag: "markdown-paste" });
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor]);
  return null;
}

export { MARKDOWN_PASTE_PATTERN };
