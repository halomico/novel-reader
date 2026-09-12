import { $convertFromMarkdownString } from "@lexical/markdown";
import { $isHeadingNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { ORIGINAL_MARKDOWN_TRANSFORMERS } from "./markdown";
import { MARKDOWN_PASTE_PATTERN } from "./plugins";
import { PAID_GATE_TOKEN } from "./serialization";
import { $createOriginalHeadingNode, $isOriginalHeadingNode } from "./nodes/OriginalHeadingNode";
import { $createPaidGateNode, $isPaidGateNode } from "./nodes/PaidGateNode";

export type OriginalComposerDraft = {
  id: number;
  articleId: number | null;
  title: string;
  editorStateJson: string;
  importedMarkdown: string;
  tagIds: number[];
  unlockSodaPrice: number;
  revision: number;
  contentHash: string;
  autosavedAt: number;
  updatedAt: number;
};

export type OriginalComposerTag = { id: number; name: string };
export type OutlineItem = { id: string; level: number; text: string; paid: boolean };
export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error" | "conflict";
export type SelectionBookmark = {
  anchor: { key: string; offset: number; type: "text" | "element" };
  focus: { key: string; offset: number; type: "text" | "element" };
};

export const MAX_TITLE_LENGTH = 100;
/** How far below the sticky chrome an outline target should come to rest. */
export const OUTLINE_SCROLL_MARGIN = 24;

/**
 * Run `task` once the browser has laid the new view out. Two animation frames is the
 * accurate signal; the timer is a fallback, because a background tab throttles frames
 * indefinitely. Whichever arrives first wins — the task never runs twice.
 */
export function afterLayout(task: () => void): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    task();
  };
  const frame = requestAnimationFrame(() => requestAnimationFrame(run));
  const timer = window.setTimeout(run, 64);
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

export function sourceLineHeight(input: HTMLTextAreaElement): number {
  const parsed = Number.parseFloat(getComputedStyle(input).lineHeight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

export function randomId(prefix: string): string {
  return `${prefix}_${typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function saveStatusText(state: SaveState, savedAt: number): string {
  if (state === "dirty") return "未保存";
  if (state === "saving") return "保存中…";
  if (state === "error") return "保存失败，点击重试";
  if (state === "conflict") return "版本冲突";
  if (!savedAt) return "点击保存";
  return `已保存 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(savedAt)}`;
}

export function initialEditorState(draft: OriginalComposerDraft) {
  if (draft.editorStateJson) return draft.editorStateJson;
  return () => {
    const source = draft.importedMarkdown || "";
    if (!source.trim()) {
      $getRoot().append($createParagraphNode());
      return;
    }
    $convertFromMarkdownString(source, ORIGINAL_MARKDOWN_TRANSFORMERS);
    for (const node of $getRoot().getChildren()) {
      if ($isParagraphNode(node) && node.getTextContent().trim() === PAID_GATE_TOKEN) {
        node.replace($createPaidGateNode());
        continue;
      }
      if ($isHeadingNode(node) && !$isOriginalHeadingNode(node)) {
        const replacement = $createOriginalHeadingNode(node.getTag() === "h3" || node.getTag() === "h2" ? "h2" : "h1");
        replacement.append(...node.getChildren());
        node.replace(replacement);
      }
    }
  };
}

type SerializedNode = { type?: string; tag?: string; anchorId?: string; text?: unknown; children?: SerializedNode[] };

function parseRoot(editorStateJson: string): SerializedNode | null {
  try {
    return (JSON.parse(editorStateJson) as { root?: SerializedNode }).root || null;
  } catch {
    return null;
  }
}

export function outlineFromEditorJson(editorStateJson: string): OutlineItem[] {
  const outline: OutlineItem[] = [];
  let paid = false;
  for (const node of parseRoot(editorStateJson)?.children || []) {
    if (node.type === "paid-gate") {
      paid = true;
      continue;
    }
    if (node.type !== "original-heading" && node.type !== "heading") continue;
    const text = (node.children || []).map((child) => String(child.text || "")).join("").trim();
    if (!text) continue;
    outline.push({
      id: String(node.anchorId || randomId("heading")),
      level: /^h[1-6]$/u.test(String(node.tag)) ? Number(String(node.tag).slice(1)) : 1,
      text,
      paid,
    });
  }
  return outline;
}

export function textCount(editorStateJson: string): number {
  let count = 0;
  const visit = (node: SerializedNode | undefined) => {
    if (!node) return;
    if (typeof node.text === "string") count += Array.from(node.text.replace(/\s+/g, "")).length;
    for (const child of node.children || []) visit(child);
  };
  visit(parseRoot(editorStateJson) || undefined);
  return count;
}

export function editorHasPaidGate(editorStateJson: string): boolean {
  return Boolean(parseRoot(editorStateJson)?.children?.some((node) => node.type === "paid-gate"));
}

/** One walk over the document for everything the chrome displays. */
export function editorMetadata(state: EditorState): { wordCount: number; outline: OutlineItem[]; hasPaidGate: boolean } {
  let wordCount = 0;
  const outline: OutlineItem[] = [];
  let hasPaidGate = false;
  state.read(() => {
    const countText = (node: LexicalNode) => {
      if ($isTextNode(node)) {
        wordCount += Array.from(node.getTextContent().replace(/\s+/gu, "")).length;
        return;
      }
      if ($isElementNode(node)) node.getChildren().forEach(countText);
    };
    for (const node of $getRoot().getChildren()) {
      if ($isPaidGateNode(node)) {
        hasPaidGate = true;
        continue;
      }
      if ($isOriginalHeadingNode(node) || $isHeadingNode(node)) {
        const text = node.getTextContent().trim();
        if (text) {
          outline.push({
            id: $isOriginalHeadingNode(node) ? node.getAnchorId() : node.getKey(),
            level: $isHeadingNode(node) && /^h[1-6]$/u.test(node.getTag()) ? Number(node.getTag().slice(1)) : 1,
            text,
            paid: hasPaidGate,
          });
        }
      }
      countText(node);
    }
  });
  return { wordCount, outline, hasPaidGate };
}

/** Keeps the outline's identity while its content is unchanged, so typing in a paragraph
 *  does not rebuild the outline panel or its heading observer. */
export function sameOutline(left: readonly OutlineItem[], right: readonly OutlineItem[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.id === other.id && item.level === other.level && item.text === other.text && item.paid === other.paid;
  });
}

function $isRawMarkdownParagraph(node: LexicalNode): boolean {
  if (!$isParagraphNode(node) || !node.getChildren().every($isTextNode)) return false;
  const text = node.getTextContent();
  return MARKDOWN_PASTE_PATTERN.test(text) || text.includes("<!-- original-heading:");
}

/**
 * Drafts saved before the rich-text composer stored raw Markdown in plain paragraphs.
 * Convert those once on open so the writer sees a document, not source. A read runs
 * first, because a synchronous update here would flush decorator re-renders while
 * React is still committing.
 */
export function normalizeMarkdownParagraphs(editor: LexicalEditor) {
  if (!editor.getEditorState().read(() => $getRoot().getChildren().some($isRawMarkdownParagraph))) return;
  editor.update(() => {
    for (const node of $getRoot().getChildren()) {
      if (!$isRawMarkdownParagraph(node)) continue;
      const holder = $createParagraphNode();
      $convertFromMarkdownString(node.getTextContent(), ORIGINAL_MARKDOWN_TRANSFORMERS, holder);
      const converted = holder.getChildren();
      if (!converted.length) {
        node.remove();
        continue;
      }
      const first = converted.shift()!;
      node.replace(first);
      let previous = first;
      for (const child of converted) {
        previous.insertAfter(child);
        previous = child;
      }
    }
  }, { discrete: true, tag: ["source-sync", SKIP_DOM_SELECTION_TAG] });
}

export function editorSelectionBookmark(editor: LexicalEditor | null): SelectionBookmark | null {
  if (!editor) return null;
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    return {
      anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
      focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
    };
  });
}

export function restoreEditorSelection(bookmark: SelectionBookmark | null) {
  if (!bookmark) return;
  const selection = $createRangeSelection();
  selection.anchor.set(bookmark.anchor.key, bookmark.anchor.offset, bookmark.anchor.type);
  selection.focus.set(bookmark.focus.key, bookmark.focus.offset, bookmark.focus.type);
  $setSelection(selection);
}

export function insertPaidGateIntoEditor(editor: LexicalEditor) {
  let alreadyExists = false;
  editor.update(() => {
    if ($getRoot().getChildren().some($isPaidGateNode)) {
      alreadyExists = true;
      return;
    }
    $insertNodes([$createPaidGateNode(), $createParagraphNode()]);
  });
  if (alreadyExists) {
    document.querySelector<HTMLElement>("[data-original-paid-gate]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
