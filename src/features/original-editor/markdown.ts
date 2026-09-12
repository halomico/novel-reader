"use client";

import { CHECK_LIST, HEADING, HIGHLIGHT, TRANSFORMERS, UNORDERED_LIST, type Transformer } from "@lexical/markdown";
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import type { HeadingTagType } from "@lexical/rich-text";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { $createOriginalHeadingNode, OriginalHeadingNode } from "./nodes/OriginalHeadingNode";
import { $createOriginalImageNode, OriginalImageNode } from "./nodes/OriginalImageNode";
import { $createPaidGateNode, PaidGateNode } from "./nodes/PaidGateNode";
import { $createDividerNode, DividerNode } from "./nodes/DividerNode";

function splitTableRow(value: string): string[] {
  const trimmed = value.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split(/(?<!\\)\|/u).map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

function isTableDelimiter(cells: string[], columns: number): boolean {
  return cells.length === columns && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function appendTableRow(table: TableNode, cells: string[], columns: number, header: boolean) {
  const row = $createTableRowNode();
  for (let index = 0; index < columns; index += 1) {
    const cell = $createTableCellNode(header ? TableCellHeaderStates.COLUMN : TableCellHeaderStates.NO_STATUS);
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode(cells[index] || ""));
    cell.append(paragraph);
    row.append(cell);
  }
  table.append(row);
}

function safeImageSrc(value: unknown): string {
  const src = String(value || "").trim();
  if (/^\/original\/assets\/[1-9]\d*$/u.test(src)) return src;
  try {
    const url = new URL(src);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/**
 * Underline has no CommonMark syntax. `_x_` is emphasis and `__x__` is strong, so
 * neither may be reused for it, and `==x==` means *highlight* in the dialects that
 * define it at all. The document therefore stores the one representation that is
 * unambiguous and survives a round trip through every renderer: an explicit `<u>`
 * element. `==x==` stays readable on import so drafts written before this keep
 * their underlines, but everything is exported as `<u>`.
 */
function underlineTransformer(importRegExp: RegExp, regExp: RegExp, trigger: string, exportable: boolean): Transformer {
  return {
    type: "text-match",
    dependencies: [],
    importRegExp,
    regExp,
    trigger,
    replace: (textNode, match) => {
      const surroundingFormat = textNode.getFormat();
      const replacement = $createTextNode(match[1]);
      replacement.setFormat(surroundingFormat);
      replacement.toggleFormat("underline");
      textNode.replace(replacement);
      // Without this the caret keeps the underline and everything typed after the
      // closing tag is silently underlined too, unlike `**` and `~~`, whose built-in
      // transformers reset the pending format for exactly this reason.
      replacement.selectEnd();
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.setFormat(surroundingFormat);
      return replacement;
    },
    export: exportable
      ? (node, _children, exportFormat) => {
        // `exportFormat` still applies bold/italic/code, so `<u>` composes with them.
        if (!$isTextNode(node) || !node.hasFormat("underline")) return null;
        return `<u>${exportFormat(node, node.getTextContent())}</u>`;
      }
      : undefined,
  };
}

const UNDERLINE = underlineTransformer(/<u>([^<>\n]+)<\/u>/u, /<u>([^<>\n]+)<\/u>$/u, ">", true);
const LEGACY_UNDERLINE = underlineTransformer(/==([^=\n]+)==/u, /==([^=\n]+)==$/u, "=", false);

/** Import/export GitHub-style tables so source, visual mode and reader preview share one document. */
const GFM_TABLE: Transformer = {
  type: "multiline-element",
  dependencies: [TableNode, TableRowNode, TableCellNode],
  regExpStart: /^\s*\|?.+\|.+\|?\s*$/u,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    const header = splitTableRow(lines[startLineIndex]);
    const delimiter = splitTableRow(lines[startLineIndex + 1] || "");
    if (!header.length || !isTableDelimiter(delimiter, header.length)) return null;

    const table = $createTableNode();
    appendTableRow(table, header, header.length, true);
    let endLineIndex = startLineIndex + 1;
    for (let lineIndex = startLineIndex + 2; lineIndex < lines.length; lineIndex += 1) {
      if (!/\|/u.test(lines[lineIndex])) break;
      const row = splitTableRow(lines[lineIndex]);
      if (!row.length) break;
      appendTableRow(table, row, header.length, false);
      endLineIndex = lineIndex;
    }
    rootNode.append(table);
    return [true, endLineIndex];
  },
  export: (node) => {
    if (!$isTableNode(node)) return null;
    const rows = node.getChildren().filter($isTableRowNode);
    if (!rows.length) return "";
    const toCells = (row: TableRowNode) => row.getChildren()
      .filter($isTableCellNode)
      .map((cell) => cell.getTextContent().trim().replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|").replace(/\n/gu, "<br>"));
    const header = toCells(rows[0]);
    if (!header.length) return "";
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return [line(header), line(header.map(() => "---")), ...rows.slice(1).map((row) => line(toCells(row)))].join("\n");
  },
  replace: () => false,
};

// The same dialect is used for shortcuts, source editing and draft imports.
// Asset dimensions travel with Markdown to reserve space after a round trip.
export const ORIGINAL_MARKDOWN_TRANSFORMERS: Transformer[] = [
  GFM_TABLE,
  {
    type: "element",
    dependencies: [PaidGateNode],
    regExp: /^(?:<!-- original-paid -->|NOVEL_READER_PAID_GATE_NODE_V1)\s*$/,
    export: (node) => node instanceof PaidGateNode ? "<!-- original-paid -->" : null,
      replace: (parent) => { parent.replace($createPaidGateNode()); },
  },
  {
    type: "element",
    dependencies: [],
    regExp: /^<!-- original-heading:[A-Za-z0-9_-]+ -->\s*$/u,
    export: () => null,
    replace: (parent) => { parent.remove(); },
  },
  {
    type: "element",
    dependencies: [DividerNode],
    regExp: /^(?:---|\*\*\*)\s*$/,
    export: (node) => node instanceof DividerNode ? "---" : null,
    replace: (parent) => { parent.replace($createDividerNode()); },
  },
  {
    type: "multiline-element",
    dependencies: [OriginalImageNode],
    regExpStart: /^!\[([^\]]*)\]\(((?:\/original\/assets\/(\d+)|https?:\/\/[^)\s]+))(?: "((?:\\"|[^"])*)")?\)\s*$/u,
    export: (node) => {
      if (!(node instanceof OriginalImageNode)) return null;
      const image = node.exportJSON();
      const alt = image.altText.replace(/[\]\n]/g, " ");
      const src = Number.isSafeInteger(image.assetId) && Number(image.assetId) > 0
        ? `/original/assets/${image.assetId}`
        : safeImageSrc(image.src);
      if (!src) return "";
      const caption = image.caption ? ` "${image.caption.replace(/"/g, '\\"')}"` : "";
      const size = Number.isSafeInteger(image.assetId) && Number(image.assetId) > 0
        ? `\n<!-- original-image-size:${image.width}x${image.height} -->`
        : "";
      return `![${alt}](${src}${caption})${size}`;
    },
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
      const size = /^<!-- original-image-size:(\d+)x(\d+) -->$/.exec(lines[startLineIndex + 1] || "");
      const src = safeImageSrc(startMatch[2]);
      if (!src) return null;
      rootNode.append($createOriginalImageNode({
        assetId: startMatch[3] ? Number(startMatch[3]) : null,
        src,
        altText: startMatch[1],
        caption: (startMatch[4] || "").replace(/\\"/g, '"'),
        width: Number(size?.[1]) || 1,
        height: Number(size?.[2]) || 1,
      }));
      return [true, startLineIndex + (size ? 1 : 0)];
    },
    replace: () => false,
  },
  {
    ...HEADING,
    dependencies: [OriginalHeadingNode],
    replace: (parent: ElementNode, children: LexicalNode[], match: string[]) => {
      const level = Math.max(1, Math.min(6, match[1].length));
      const heading = $createOriginalHeadingNode(`h${level}` as HeadingTagType);
      heading.append(...children);
      parent.replace(heading);
      heading.selectEnd();
    },
  },
  UNDERLINE,
  LEGACY_UNDERLINE,
  CHECK_LIST,
  ...TRANSFORMERS.filter((transformer) => (
    transformer !== HEADING && transformer !== HIGHLIGHT && transformer !== UNORDERED_LIST
  )),
  UNORDERED_LIST,
];

