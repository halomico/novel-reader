import { $convertFromMarkdownString, HEADING, type Transformer } from "@lexical/markdown";
import {
  $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $getSelection, $isElementNode,
  $isParagraphNode, $isRangeSelection, $isTextNode, $setSelection,
  HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG, type LexicalEditor, type LexicalNode, type TextNode,
} from "lexical";

const BUFFER_TAG = "buffered-markdown";
const MARKDOWN_BLOCK_RE = /^\s{0,3}(?:#{1,6}\s+\S|>\s*\S|[-+*]\s+\S|\d+[.)]\s+\S|[-+*]\s+\[[ xX]\]\s+\S|!\[[^\]\n]*\]\((?:\/original\/assets\/\d+|https?:\/\/)[^)]+\)|```|~~~|---\s*$|\|.+\|)/u;

const INLINE_WINDOW = 512;
const IMAGE_RE = /!\[[^\]\n]*\]\((?:\/original\/assets\/\d+|https?:\/\/[^)\s]+)(?: "[^"]*")?\)$/;

type InlineFormat = { tag: string; intraword?: boolean };
type InlineIndex = {
  textMatch: Extract<Transformer, { type: "text-match" }>[];
  formats: InlineFormat[];
  /** Last character of every construct that can close an inline span. */
  closers: Set<string>;
};

/** Derived once per transformer list. Rebuilding this per keystroke (let alone per
 *  scanned offset) dominated typing cost on long documents. */
const inlineIndexes = new WeakMap<Transformer[], InlineIndex>();

function inlineIndex(transformers: Transformer[]): InlineIndex {
  const cached = inlineIndexes.get(transformers);
  if (cached) return cached;
  const textMatch = transformers.filter(
    (item): item is Extract<Transformer, { type: "text-match" }> => item.type === "text-match",
  );
  const formats = transformers
    .filter((item): item is Extract<Transformer, { type: "text-format" }> => item.type === "text-format")
    .sort((left, right) => right.tag.length - left.tag.length)
    .map(({ tag, intraword }) => ({ tag, intraword }));
  const closers = new Set<string>([")"]);
  for (const { tag } of formats) closers.add(tag[tag.length - 1]);
  const index: InlineIndex = { textMatch, formats, closers };
  inlineIndexes.set(transformers, index);
  return index;
}

function completedInline(text: string, index: InlineIndex) {
  const image = IMAGE_RE.exec(text);
  if (image) return { start: image.index, raw: image[0], marker: ")" };
  for (const transformer of index.textMatch) {
    const match = transformer.regExp.exec(text);
    if (match && match.index + match[0].length === text.length && !/[!\\]/.test(text[match.index - 1] || "")) {
      return { start: match.index, raw: match[0], marker: ")" };
    }
  }
  for (const { tag, intraword } of index.formats) {
    if (!text.endsWith(tag)) continue;
    const start = text.lastIndexOf(tag, text.length - tag.length - 1);
    const body = text.slice(start + tag.length, -tag.length);
    if (start < 0 || !body.trim() || body.includes("\n") || body.endsWith("\\")) continue;
    if (text[start - 1] === "\\" || text[start - 1] === tag[0] || body.startsWith(tag[0])) continue;
    if (intraword === false && /[\p{L}\p{N}]/u.test(text[start - 1] || "")) continue;
    return { start, raw: text.slice(start), marker: tag[0] };
  }
  return null;
}

/** `deep` scans back over a whole burst (IME commit, paste, autocomplete). Ordinary
 *  single-character typing can only have completed a span at the caret itself, so the
 *  common path is one Set lookup instead of a 512-position regex sweep. */
function pendingInlineEnd(text: string, caretOffset: number, transformers: Transformer[], deep = false) {
  const index = inlineIndex(transformers);
  const latest = Math.min(text.length, caretOffset);
  if (latest < 1) return null;
  const earliest = deep ? Math.max(1, latest - INLINE_WINDOW) : latest;
  for (let end = latest; end >= earliest; end -= 1) {
    if (!index.closers.has(text[end - 1])) continue;
    if (completedInline(text.slice(Math.max(0, end - INLINE_WINDOW), end), index)) return end;
  }
  return null;
}

function completedInlineAt(text: string, end: number, transformers: Transformer[]) {
  const start = Math.max(0, end - INLINE_WINDOW);
  const match = completedInline(text.slice(start, end), inlineIndex(transformers));
  return match ? { ...match, start: match.start + start } : null;
}

function convertInline(node: TextNode, end: number, transformers: Transformer[], caretAtTailEnd = false) {
  if (node.hasFormat("code") || node.getParent()?.getType() === "code") return false;
  const match = completedInlineAt(node.getTextContent(), end, transformers);
  if (!match) return false;
  const temporary = $createParagraphNode();
  const selection = $getSelection()?.clone() || null;
  $convertFromMarkdownString(match.raw, transformers, temporary);
  $setSelection(selection);
  const parsed = temporary.getFirstChild();
  if (!parsed) return false;
  if (!$isParagraphNode(parsed)) {
    const parent = node.getParent();
    if (match.start || !$isParagraphNode(parent) || parent.getChildrenSize() !== 1) return false;
    const tail = $createParagraphNode();
    const remainder = node.getTextContent().slice(end);
    parent.insertAfter(tail);
    node.setTextContent(remainder);
    tail.append(node);
    parent.replace(parsed);
    node.select(remainder.length, remainder.length);
    return true;
  }
  const children = parsed.getChildren();
  // An escaped or incomplete marker must remain editable source.
  if (children.length === 1 && $isTextNode(children[0]) && children[0].getTextContent() === match.raw) return false;
  const pieces = node.splitText(match.start, end);
  const target = pieces[match.start === 0 ? 0 : 1];
  let lastInserted = target.getPreviousSibling();
  for (const child of children) {
    target.insertBefore(child);
    lastInserted = child;
  }
  const tail = target.getNextSibling();
  target.remove();
  if ($isTextNode(tail)) {
    const offset = caretAtTailEnd ? tail.getTextContentSize() : 0;
    tail.select(offset, offset);
  } else if (lastInserted) {
    const caret = $createTextNode("");
    lastInserted.insertAfter(caret);
    caret.select(0, 0);
  }
  return true;
}

function convertMarkdownBlock(block: LexicalNode, transformers: Transformer[]) {
  if (!$isParagraphNode(block) || block.getChildrenSize() === 0) return false;
  if (!block.getChildren().every((child) => $isTextNode(child))) return false;
  const text = block.getTextContent();
  if (!MARKDOWN_BLOCK_RE.test(text)) return false;
  const temporary = $createParagraphNode();
  $convertFromMarkdownString(text, transformers, temporary);
  const converted = temporary.getChildren();
  if (!converted.length) return false;
  if (converted.length === 1 && $isParagraphNode(converted[0]) && converted[0].getTextContent() === text) return false;
  const first = converted.shift()!;
  block.replace(first);
  let previous = first;
  for (const child of converted) {
    previous.insertAfter(child);
    previous = child;
  }
  return true;
}

function settleBlock(key: string, transformers: Transformer[]) {
  const block = $getNodeByKey(key);
  if (!$isElementNode(block) || block.getType() === "code") return;
  if (convertMarkdownBlock(block, transformers)) return;
  for (const node of block.getAllTextNodes()) convertInline(node, node.getTextContentSize(), transformers);
  if (!$isParagraphNode(block) || !block.isAttached()) return;
  const first = block.getFirstChild();
  if (!$isTextNode(first)) return;
  const match = HEADING.regExp.exec(first.getTextContent());
  const heading = transformers.find(item => item.type === "element" && item.regExp === HEADING.regExp);
  if (!match || heading?.type !== "element") return;
  first.spliceText(0, match[0].length, "");
  heading.replace(block, block.getChildren(), match, false);
}

export function commitBufferedMarkdown(editor: LexicalEditor, transformers: Transformer[]) {
  editor.update(() => {
    for (const block of $getRoot().getChildren()) settleBlock(block.getKey(), transformers);
  }, { discrete: true, tag: [BUFFER_TAG, SKIP_DOM_SELECTION_TAG] });
}

export function registerBufferedMarkdown(editor: LexicalEditor, transformers: Transformer[]) {
  let lastSnapshot: {
    key: string;
    block: string | null;
    offset: number;
    text: string;
  } | null = null;
  const unregisterUpdate = editor.registerUpdateListener(({ editorState, prevEditorState, tags }) => {
    if (editor.isComposing() || !editor.isEditable() || tags.has(BUFFER_TAG) || tags.has("source-sync") || tags.has("historic")) return;
    const previous = prevEditorState.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
      const node = selection.anchor.getNode();
      return { key: node.getKey(), block: node.getTopLevelElement()?.getKey(), offset: selection.anchor.offset, text: node.getTextContent() };
    }) || lastSnapshot;
    if (!previous) {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const node = selection.anchor.getNode();
        lastSnapshot = { key: node.getKey(), block: node.getTopLevelElement()?.getKey() || null, offset: selection.anchor.offset, text: node.getTextContent() };
      });
      return;
    }
    const change = editorState.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
      const node = selection.anchor.getNode();
      if (previous.block && node.getTopLevelElement()?.getKey() !== previous.block) return { kind: "block" as const, key: previous.block };
      if (!$isTextNode(node)) return null;
      // More than one character arrived at once (IME commit, paste, autocomplete), so a
      // marker may have closed behind the caret rather than at it.
      const burst = node.getKey() !== previous.key || selection.anchor.offset - previous.offset > 1;
      const end = pendingInlineEnd(node.getTextContent(), selection.anchor.offset, transformers, burst);
      if (end === null) return null;
      return { kind: "inline" as const, key: node.getKey(), end };
    });
    editorState.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        lastSnapshot = null;
        return;
      }
      const node = selection.anchor.getNode();
      lastSnapshot = { key: node.getKey(), block: node.getTopLevelElement()?.getKey() || null, offset: selection.anchor.offset, text: node.getTextContent() };
    });
    if (!change) return;
    editor.update(() => {
      if (change.kind === "block") {
        const selection = $getSelection()?.clone() || null;
        settleBlock(change.key, transformers);
        $setSelection(selection);
      } else {
        const node = $getNodeByKey(change.key);
        if ($isTextNode(node)) convertInline(node, change.end, transformers, true);
      }
    }, { tag: [BUFFER_TAG, HISTORY_PUSH_TAG] });
  });
  let removeRootListener = () => {};
  const unregisterRoot = editor.registerRootListener((root, previousRoot) => {
    removeRootListener();
    if (previousRoot === root || !root) return;
    // The update listener skips work while an IME is composing, so the committed text
    // is settled once here. Plain `input` needs no hook: every model change already
    // reaches the update listener, and scanning twice per keystroke doubled the cost.
    const settleCompositionEnd = () => {
      if (editor.isComposing() || !editor.isEditable()) return;
      let target: { key: string; end: number } | null = null;
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const node = selection.anchor.getNode();
        if (!$isTextNode(node) || selection.anchor.offset < 1) return;
        const end = pendingInlineEnd(node.getTextContent(), selection.anchor.offset, transformers, true);
        if (end !== null) target = { key: node.getKey(), end };
      });
      if (!target) return;
      editor.update(() => {
        const node = $getNodeByKey(target!.key);
        if ($isTextNode(node)) convertInline(node, target!.end, transformers, true);
      }, { tag: [BUFFER_TAG, HISTORY_PUSH_TAG] });
    };
    root.addEventListener("compositionend", settleCompositionEnd);
    removeRootListener = () => {
      root.removeEventListener("compositionend", settleCompositionEnd);
    };
  });
  return () => {
    removeRootListener();
    unregisterRoot();
    unregisterUpdate();
  };
}
