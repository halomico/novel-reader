"use client";

import { $isCodeNode } from "@lexical/code";
import { $isLinkNode } from "@lexical/link";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type RangeSelection,
  type TextFormatType,
} from "lexical";

/** The inline formats the toolbar can apply, lock and clear. */
export const ORIGINAL_TEXT_FORMATS = ["bold", "italic", "underline", "strikethrough", "code"] as const;
export type OriginalTextFormat = (typeof ORIGINAL_TEXT_FORMATS)[number];

export const EMPTY_TEXT_FORMATS: Record<OriginalTextFormat, boolean> = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
};

export function readSelectionFormats(): Record<OriginalTextFormat, boolean> {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return EMPTY_TEXT_FORMATS;
  return {
    bold: selection.hasFormat("bold"),
    italic: selection.hasFormat("italic"),
    underline: selection.hasFormat("underline"),
    strikethrough: selection.hasFormat("strikethrough"),
    code: selection.hasFormat("code"),
  };
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
    if ($isQuoteNode(block) || block.getType() === "heading" || block.getType() === "original-heading") {
      const paragraph = $createParagraphNode();
      paragraph.append(...block.getChildren());
      block.replace(paragraph);
    }
  }
}

/** Turn the blocks touched by the selection into `create()` without disturbing others. */
export function $setSelectedBlocks(create: () => ElementNode): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  $setBlocksType(selection, create);
}

/**
 * A guaranteed way out of any block. Code blocks legitimately contain blank lines and
 * quotes legitimately contain blank paragraphs, so "press Enter twice" cannot be the
 * only exit. This inserts a fresh paragraph directly after the enclosing top-level
 * block and puts the caret in it.
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

/** Apply the formats the toolbar has locked to a collapsed caret. Returns true when
 *  something actually changed, so callers can skip a pointless editor update. */
export function $applyLockedFormats(locked: readonly OriginalTextFormat[]): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  if ($selectionIsInCode(selection)) return false;
  let changed = false;
  for (const format of locked) {
    if (selection.hasFormat(format as TextFormatType)) continue;
    selection.formatText(format as TextFormatType);
    changed = true;
  }
  return changed;
}

export function $lockedFormatsMissing(locked: readonly OriginalTextFormat[]): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  if ($selectionIsInCode(selection)) return false;
  return locked.some((format) => !selection.hasFormat(format as TextFormatType));
}
