"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import type { LexicalEditor } from "lexical";
import { ORIGINAL_MARKDOWN_TRANSFORMERS } from "./markdown";
import { registerBufferedMarkdown, commitBufferedMarkdown as commit } from "./buffered-markdown";

const blockShortcuts = ORIGINAL_MARKDOWN_TRANSFORMERS.filter(item =>
  item.type === "element" || item.type === "multiline-element",
);

export function commitBufferedMarkdown(editor: LexicalEditor) {
  commit(editor, ORIGINAL_MARKDOWN_TRANSFORMERS);
}

export function BufferedMarkdownPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerBufferedMarkdown(editor, ORIGINAL_MARKDOWN_TRANSFORMERS), [editor]);
  return <MarkdownShortcutPlugin transformers={blockShortcuts} />;
}
