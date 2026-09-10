"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isCodeNode } from "@lexical/code";
import { $isTableCellNode, $isTableNode, $isTableRowNode } from "@lexical/table";
import { CHINESE_INDENT, $handleLexicalChineseOutdent } from "./tab-indentation";

export function registerEditorTabIndentation(editor: LexicalEditor): () => void {
  return editor.registerCommand<KeyboardEvent>(
    KEY_TAB_COMMAND,
    (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;

      const nodes = selection.getNodes();

      // Let Lexical's table plugin handle cell navigation. Paragraph-style
      // indentation here would trap Tab inside a cell and make tables unusable.
      const isInsideTable = (node: LexicalNode) => {
        let current: LexicalNode | null = node;
        while (current) {
          if ($isTableCellNode(current) || $isTableRowNode(current) || $isTableNode(current)) return true;
          current = current.getParent();
        }
        return false;
      };
      const isTable = nodes.some(isInsideTable);
      if (isTable) return false;

      // Prevent browser from shifting focus outside the editor.
      event.preventDefault();

      // 1. If selection is inside a list, indent or outdent the list item
      const isList = nodes.some(
        (node) =>
          $isListItemNode(node) ||
          $isListNode(node) ||
          $isListItemNode(node.getParent()) ||
          $isListNode(node.getParent()),
      );

      if (isList) {
        editor.dispatchCommand(
          event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
          undefined,
        );
        return true;
      }

      // 2. If selection is inside a code block, handle code spacing
      const isCode = nodes.some(
        (node) =>
          $isCodeNode(node) ||
          $isCodeNode(node.getParent()),
      );

      if (isCode) {
        if (event.shiftKey) {
          editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
        } else {
          selection.insertText("  ");
        }
        return true;
      }

      // 3. Normal paragraph / heading / quote / general narrative text
      if (event.shiftKey) {
        // Outdent: strip leading Chinese full-width indent or spaces
        const stripped = $handleLexicalChineseOutdent(selection);
        if (!stripped) {
          editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
        }
      } else {
        // Standard Chinese paragraph indentation (two full-width em-spaces: \u3000\u3000)
        selection.insertText(CHINESE_INDENT);
      }

      return true;
    },
    COMMAND_PRIORITY_EDITOR,
  );
}

export function EditorTabPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return registerEditorTabIndentation(editor);
  }, [editor]);

  return null;
}
