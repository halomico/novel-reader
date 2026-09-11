"use client";

import { $isCodeNode } from "@lexical/code";
import { $isLinkNode } from "@lexical/link";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $createQuoteNode, $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { $createOriginalHeadingNode } from "./nodes/OriginalHeadingNode";

/** The inline formats the toolbar toggles and clears. */
export const ORIGINAL_TEXT_FORMATS = ["bold", "italic", "underline", "strikethrough"] as const;
export type OriginalTextFormat = (typeof ORIGINAL_TEXT_FORMATS)[number];

/** The block kinds the toolbar can switch the current block to and back. */
export type OriginalBlockKind = "paragraph" | "heading" | "quote" | "other";

export type OriginalSelectionState = {
  formats: Record<OriginalTextFormat, boolean>;
  block: OriginalBlockKind;
};

export const EMPTY_SELECTION_STATE: OriginalSelectionState = {
  formats: { bold: false, italic: false, underline: false, strikethrough: false },
  block: "paragraph",
};

/** What the toolbar should show as pressed for the current selection, including the
 *  pending format a collapsed caret will type with. */
export function $readSelectionState(): OriginalSelectionState {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return EMPTY_SELECTION_STATE;
  const top = selection.anchor.getNode().getTopLevelElement();
  return {
    formats: {
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      underline: selection.hasFormat("underline"),
      strikethrough: selection.hasFormat("strikethrough"),
    },
    block: $isHeadingNode(top) ? "heading" : $isQuoteNode(top) ? "quote" : $isParagraphNode(top) ? "paragraph" : "other",
  };
}

export function sameSelectionState(left: OriginalSelectionState, right: OriginalSelectionState): boolean {
  return left.block === right.block && ORIGINAL_TEXT_FORMATS.every((format) => left.formats[format] === right.formats[format]);
}

/** A fenced code block stores literal text; inline styles there would be lost on export. */
export function $selectionIsInCode(selection: RangeSelection): boolean {
  for (const node of [selection.anchor.getNode(), selection.focus.getNode()]) {
    for (let current: LexicalNode | null = node; current; current = current.getParent()) {
      if ($isCodeNode(current)) return true;
    }
  }
  return false;
}

/** One click turns the blocks under the selection into `kind`; a second click on the
 *  same button turns them back into body text. */
export function $toggleBlock(kind: "heading" | "quote"): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const current = $readSelectionState().block;
  $setBlocksType(selection, () => {
    if (current === kind) return $createParagraphNode();
    return kind === "heading" ? $createOriginalHeadingNode("h1") : $createQuoteNode();
  });
}

export function $setParagraphBlocks(): void {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createParagraphNode());
}

function orderedPoints(selection: RangeSelection) {
  return selection.isBackward()
    ? { start: selection.focus, end: selection.anchor }
    : { start: selection.anchor, end: selection.focus };
}

function firstLeaf(node: LexicalNode): LexicalNode {
  let current = node;
  while ($isElementNode(current)) {
    const child: LexicalNode | null = current.getFirstChild();
    if (!child) return current;
    current = child;
  }
  return current;
}

function lastLeaf(node: LexicalNode): LexicalNode {
  let current = node;
  while ($isElementNode(current)) {
    const child: LexicalNode | null = current.getLastChild();
    if (!child) return current;
    current = child;
  }
  return current;
}

/**
 * True when the selection covers every character of `block`. Partial selections must
 * leave the block structure alone — clearing formatting inside one sentence of a
 * heading should not demote the whole heading to a paragraph.
 */
function blockFullySelected(block: ElementNode, selection: RangeSelection): boolean {
  const { start, end } = orderedPoints(selection);
  const startNode = start.getNode();
  const endNode = end.getNode();
  const head = firstLeaf(block);
  const tail = lastLeaf(block);
  const startsAtHead = startNode.is(head)
    ? start.offset === 0
    : startNode.isBefore(head) || startNode.is(block) && start.offset === 0;
  const endsAtTail = endNode.is(tail)
    ? end.offset >= ($isTextNode(tail) ? tail.getTextContentSize() : $isElementNode(tail) ? tail.getChildrenSize() : 0)
    : tail.isBefore(endNode) || endNode.is(block) && end.offset >= block.getChildrenSize();
  return startsAtHead && endsAtTail;
}

function topLevelBlocksInSelection(selection: RangeSelection): ElementNode[] {
  const blocks: ElementNode[] = [];
  for (const node of selection.getNodes()) {
    const block = node.getTopLevelElement();
    if ($isElementNode(block) && !blocks.some((item) => item.is(block))) blocks.push(block);
  }
  return blocks;
}

/**
 * Clear every inline format in the selection in one history step.
 *
 * With a collapsed caret this only resets what the next keystrokes will look like.
 * With a range it strips text formats and inline styles, unwraps links while keeping
 * their label, and demotes headings, quotes and lists back to paragraphs — but only
 * those blocks the selection actually covers end to end. Images, dividers and the paid
 * boundary are decorator blocks with no inline formatting, so they pass through
 * untouched instead of being flattened away.
 */
export function $clearFormatting(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  if (selection.isCollapsed()) {
    selection.setFormat(0);
    selection.setStyle("");
    return;
  }

  const fullyCovered = topLevelBlocksInSelection(selection)
    .filter((block) => $isElementNode(block) && blockFullySelected(block, selection));

  // `extract` splits the boundary text nodes, so a partly selected word only loses
  // formatting over the characters the user actually selected.
  for (const node of selection.extract()) {
    if (!$isTextNode(node)) continue;
    node.setFormat(0);
    node.setStyle("");
    const parent = node.getParent();
    if ($isLinkNode(parent)) {
      // Keep the visible label; drop the link itself.
      for (const child of parent.getChildren()) parent.insertBefore(child);
      parent.remove();
    }
  }

  for (const block of fullyCovered) {
    if (!block.isAttached()) continue;
    if ($isListNode(block)) {
      for (const item of block.getChildren()) {
        if (!$isListItemNode(item)) continue;
        const paragraph = $createParagraphNode();
        paragraph.append(...item.getChildren());
        block.insertBefore(paragraph);
      }
      block.remove();
      continue;
    }
    if ($isQuoteNode(block) || $isHeadingNode(block)) {
      const paragraph = $createParagraphNode();
      paragraph.append(...block.getChildren());
      block.replace(paragraph);
    }
  }
}

/**
 * A guaranteed way out of any block (Ctrl/⌘+Enter). Code blocks legitimately contain
 * blank lines, so "press Enter on an empty line" cannot be their only exit. This inserts
 * a fresh paragraph directly after the enclosing top-level block and puts the caret in it.
 */
export function $escapeCurrentBlock(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const block = selection.anchor.getNode().getTopLevelElement();
  if (!block) return false;
  const paragraph = $createParagraphNode();
  block.insertAfter(paragraph);
  paragraph.select();
  return true;
}
