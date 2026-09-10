"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import { ORIGINAL_MARKDOWN_TRANSFORMERS } from "./markdown";
import { $escapeCurrentBlock } from "./editor-commands";
import { $isPaidGateNode } from "./nodes/PaidGateNode";

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

/**
 * Every block structure needs a way out that does not rely on its own content.
 * A blank line inside a fenced code block is legitimate code, so "press Enter twice"
 * cannot be the exit; Ctrl/Cmd+Enter always opens a fresh paragraph after the block,
 * and ArrowDown past the end of the last block does the same.
 */
export function BlockEscapePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => mergeRegister(
    // Lexical's fenced-code shortcut fires on ``` followed by a space. Everyone types
    // ``` and presses Enter, so that path is wired up too.
    editor.registerCommand<KeyboardEvent | null>(KEY_ENTER_COMMAND, (event) => {
      if (event && (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
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
    editor.registerCommand<KeyboardEvent | null>(KEY_ENTER_COMMAND, (event) => {
      if (!event || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
      const escaped = $escapeCurrentBlock();
      if (escaped) event.preventDefault();
      return escaped;
    }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand<KeyboardEvent | null>(KEY_ARROW_DOWN_COMMAND, () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      const block = selection.anchor.getNode().getTopLevelElement();
      if (!$isCodeNode(block) || block.getNextSibling()) return false;
      const paragraph = $createParagraphNode();
      block.insertAfter(paragraph);
      paragraph.select();
      return true;
    }, COMMAND_PRIORITY_LOW),
  ), [editor]);
  return null;
}

/**
 * The paid boundary is a decorator block, so a plain Backspace in the paragraph after
 * it would silently delete it. Route that through the caller instead, which confirms
 * and keeps focus in the editor.
 */
export function PaidGateSafetyPlugin({ onRemoveGate }: { onRemoveGate: (remove: () => void) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
    const node = selection.anchor.getNode();
    if (selection.anchor.offset !== 0) return false;
    const block = node.getTopLevelElement();
    const previous = block?.getPreviousSibling();
    if (!$isPaidGateNode(previous)) return false;
    event?.preventDefault();
    onRemoveGate(() => previous.remove());
    return true;
  }, COMMAND_PRIORITY_LOW), [editor, onRemoveGate]);
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
