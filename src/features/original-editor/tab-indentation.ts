import type { RangeSelection } from "lexical";
import { $isTextNode } from "lexical";

export const CHINESE_INDENT = "\u3000\u3000";

/**
 * Strips leading Chinese full-width indent (\u3000\u3000) or spaces from the first child text node of the block.
 */
export function $handleLexicalChineseOutdent(selection: RangeSelection): boolean {
  const anchorNode = selection.anchor.getNode();
  const parent = $isTextNode(anchorNode) ? anchorNode.getParent() : anchorNode;
  if (!parent) return false;

  const firstChild = parent.getFirstChild();
  if ($isTextNode(firstChild)) {
    const text = firstChild.getTextContent();
    if (text.startsWith(CHINESE_INDENT)) {
      firstChild.setTextContent(text.slice(CHINESE_INDENT.length));
      return true;
    }
    if (text.startsWith("\u3000")) {
      firstChild.setTextContent(text.slice(1));
      return true;
    }
    if (text.startsWith("    ")) {
      firstChild.setTextContent(text.slice(4));
      return true;
    }
    if (text.startsWith("  ")) {
      firstChild.setTextContent(text.slice(2));
      return true;
    }
    if (text.startsWith("\t")) {
      firstChild.setTextContent(text.slice(1));
      return true;
    }
  }
  return false;
}

export type TextareaIndentResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

/**
 * Handles Tab indentation in a plain textarea (e.g. Markdown source mode).
 * - Single point selection: inserts Chinese indent or spaces.
 * - Multi-line selection: indents every line across the range.
 */
export function applyTextareaIndent(
  value: string,
  start: number,
  end: number,
  indentStr = CHINESE_INDENT,
): TextareaIndentResult {
  if (start === end) {
    // Single caret: insert indent
    const nextValue = value.slice(0, start) + indentStr + value.slice(end);
    const newPos = start + indentStr.length;
    return {
      value: nextValue,
      selectionStart: newPos,
      selectionEnd: newPos,
    };
  }

  // Range selection: find bounding lines
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  const targetBlock = value.slice(lineStart, lineEnd);
  const lines = targetBlock.split("\n");
  const indentedLines = lines.map((line) => indentStr + line);
  const replacement = indentedLines.join("\n");

  const nextValue = value.slice(0, lineStart) + replacement + value.slice(lineEnd);
  const addedCharsTotal = replacement.length - targetBlock.length;

  return {
    value: nextValue,
    selectionStart: start + indentStr.length,
    selectionEnd: end + addedCharsTotal,
  };
}

/**
 * Handles Shift+Tab outdent in a plain textarea.
 * - Removes leading indent (Chinese full-width or spaces) from the selected line(s).
 */
export function applyTextareaOutdent(
  value: string,
  start: number,
  end: number,
): TextareaIndentResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  const targetBlock = value.slice(lineStart, lineEnd);
  const lines = targetBlock.split("\n");

  let firstLineRemoved = 0;
  let totalRemoved = 0;

  const outdentedLines = lines.map((line, idx) => {
    let removed = 0;
    let nextLine = line;
    if (line.startsWith(CHINESE_INDENT)) {
      removed = CHINESE_INDENT.length;
      nextLine = line.slice(CHINESE_INDENT.length);
    } else if (line.startsWith("\u3000")) {
      removed = 1;
      nextLine = line.slice(1);
    } else if (line.startsWith("    ")) {
      removed = 4;
      nextLine = line.slice(4);
    } else if (line.startsWith("  ")) {
      removed = 2;
      nextLine = line.slice(2);
    } else if (line.startsWith("\t") || line.startsWith(" ")) {
      removed = 1;
      nextLine = line.slice(1);
    }

    if (idx === 0) firstLineRemoved = removed;
    totalRemoved += removed;
    return nextLine;
  });

  const replacement = outdentedLines.join("\n");
  const nextValue = value.slice(0, lineStart) + replacement + value.slice(lineEnd);

  const nextStart = Math.max(lineStart, start - firstLineRemoved);
  const nextEnd = Math.max(nextStart, end - totalRemoved);

  return {
    value: nextValue,
    selectionStart: nextStart,
    selectionEnd: nextEnd,
  };
}
