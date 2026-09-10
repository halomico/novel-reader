"use client";

import {
  ChevronLeft,
  Settings2,
  Bold,
  Check,
  Code2,
  Eraser,
  Eye,
  Heading1,
  Italic,
  Link2,
  List,
  LockKeyhole,
  Minus,
  Plus,
  Search,
  Strikethrough,
  Tags,
  Type,
  Underline,
  Quote,
  Redo2,
  Save,
  Undo2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { BufferedMarkdownPlugin, commitBufferedMarkdown } from "./BufferedMarkdownPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { $setBlocksType } from "@lexical/selection";
import { CodeNode } from "@lexical/code";
import { LinkNode, TOGGLE_LINK_COMMAND, $createLinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode, $createQuoteNode, $isHeadingNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isParagraphNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  PASTE_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { isValidOriginalTagName, normalizeOriginalTagName } from "@/lib/original-constants";
import { countOriginalMarkdownCharacters, PAID_GATE_TOKEN, serializeOriginalEditorState } from "./serialization";
import { ORIGINAL_MARKDOWN_TRANSFORMERS } from "./markdown";
import { deleteLocalOriginalDraft, readLocalOriginalDraft, writeLocalOriginalDraft } from "./local-draft";
import { DividerNode, $createDividerNode } from "./nodes/DividerNode";
import { OriginalHeadingNode, $createOriginalHeadingNode, $isOriginalHeadingNode } from "./nodes/OriginalHeadingNode";
import { OriginalImageNode } from "./nodes/OriginalImageNode";
import { PaidGateNode, $createPaidGateNode, $isPaidGateNode } from "./nodes/PaidGateNode";
import { editMarkdownSource, type SourceTool } from "./source-editing";
import { EditorTabPlugin } from "./EditorTabPlugin";
import { applyTextareaIndent, applyTextareaOutdent } from "./tab-indentation";
import { OriginalMarkdown } from "@/components/OriginalMarkdown";
import { UserAvatar } from "@/components/UserAvatar";
import styles from "./OriginalComposer.module.css";

export type OriginalComposerDraft = {
  id: number;
  articleId: number | null;
  title: string;
  editorStateJson: string;
  legacyMarkdown: string;
  tagIds: number[];
  unlockSodaPrice: number;
  revision: number;
  contentHash: string;
  autosavedAt: number;
  updatedAt: number;
};

export type OriginalComposerTag = { id: number; name: string };

type SaveState = "clean" | "dirty" | "saving" | "saved" | "offline" | "error" | "conflict";
type ComposerMode = "visual" | "source" | "preview";
type OutlineItem = { id: string; level: number; text: string; paid: boolean };
type SelectionBookmark = {
  anchor: { key: string; offset: number; type: "text" | "element" };
  focus: { key: string; offset: number; type: "text" | "element" };
};

const MAX_TITLE_LENGTH = 100;
const EDITOR_METADATA_DEBOUNCE_MS = 260;
const LOCAL_RECOVERY_DEBOUNCE_MS = 1_200;
const LOCAL_RECOVERY_POLL_MS = 2_000;
const EMPTY_TEXT_FORMATS = { bold: false, italic: false, underline: false, strikethrough: false };
const MARKDOWN_PASTE_PATTERN = /(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s|!\[[^\]\n]*\]\(|```|~~~|---\s*$)|(?:^|\n)\s*\|[^\n]+\|\s*\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?|(?:\*\*|__|~~|==|`|!?\[[^\]\n]+\]\()/u;
function randomId(prefix: string): string {
  return `${prefix}_${typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function initialEditorState(draft: OriginalComposerDraft) {
  if (draft.editorStateJson) return draft.editorStateJson;
  return () => {
    const source = draft.legacyMarkdown || "";
    if (source.trim()) {
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
    } else {
      $getRoot().append($createParagraphNode());
    }
  };
}

function outlineFromEditorJson(editorStateJson: string): OutlineItem[] {
  try {
    const parsed = JSON.parse(editorStateJson) as {
      root?: { children?: Array<{ type?: string; tag?: string; anchorId?: string; children?: Array<{ text?: string; children?: unknown[] }> }> };
    };
    const outline: OutlineItem[] = [];
    let paid = false;
    for (const node of parsed.root?.children || []) {
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
  } catch {
    return [];
  }
}

function textCount(editorStateJson: string): number {
  try {
    const parsed = JSON.parse(editorStateJson) as { root?: unknown };
    let count = 0;
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as { text?: unknown; children?: unknown[] };
      if (typeof node.text === "string") count += Array.from(node.text.replace(/\s+/g, "")).length;
      for (const child of node.children || []) visit(child);
    };
    visit(parsed.root);
    return count;
  } catch {
    return 0;
  }
}

function statusText(state: SaveState, savedAt: number): string {
  if (state === "dirty") return "未保存";
  if (state === "saving") return "正在保存…";
  if (state === "offline") return "离线，点击保存重试";
  if (state === "error") return "保存失败，点击重试";
  if (state === "conflict") return "另一页面保存了更新版本";
  if (state === "saved" || state === "clean") {
    if (!savedAt) return "已保存";
    return `已保存 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(savedAt)}`;
  }
  return "已保存";
}

function editorHasPaidGate(editorStateJson: string): boolean {
  try {
    const parsed = JSON.parse(editorStateJson) as { root?: { children?: Array<{ type?: string }> } };
    return Boolean(parsed.root?.children?.some((node) => node.type === "paid-gate"));
  } catch {
    return false;
  }
}

function editorMetadata(state: EditorState): { wordCount: number; outline: OutlineItem[]; hasPaidGate: boolean } {
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

function normalizeMarkdownParagraphs(editor: LexicalEditor) {
  editor.update(() => {
    for (const node of $getRoot().getChildren()) {
      if (!$isParagraphNode(node) || !node.getChildren().every($isTextNode)) continue;
      const text = node.getTextContent();
      if (!MARKDOWN_PASTE_PATTERN.test(text) && !/(?:^|\n)\s{0,3}(?:<!-- original-heading:)|(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`)/u.test(text)) continue;
      const holder = $createParagraphNode();
      $convertFromMarkdownString(text, ORIGINAL_MARKDOWN_TRANSFORMERS, holder);
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

function editorSelectionBookmark(editor: LexicalEditor | null): SelectionBookmark | null {
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

function restoreEditorSelection(bookmark: SelectionBookmark | null) {
  if (!bookmark) return;
  const selection = $createRangeSelection();
  selection.anchor.set(bookmark.anchor.key, bookmark.anchor.offset, bookmark.anchor.type);
  selection.focus.set(bookmark.focus.key, bookmark.focus.offset, bookmark.focus.type);
  $setSelection(selection);
}

function replaceCurrentBlock(editor: LexicalEditor, kind: "paragraph" | "h1" | "h2" | "quote") {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    $setBlocksType(selection, () => {
      if (kind === "h1" || kind === "h2") return $createOriginalHeadingNode(kind);
      if (kind === "quote") return $createQuoteNode();
      return $createParagraphNode();
    });
  });
}

function clearCurrentFormatting(editor: LexicalEditor) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    if (selection.isCollapsed()) {
      selection.setFormat(0);
      return;
    }
    for (const node of selection.getNodes()) {
      if ($isTextNode(node)) node.setFormat(0);
    }
    $setBlocksType(selection, () => $createParagraphNode());
  });
}

function insertPaidGateIntoEditor(editor: LexicalEditor) {
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

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  onDoubleClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  children: React.ReactNode;
}) {
  const clickTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
  }, []);

  function handleClick() {
    if (!onDoubleClick) {
      onClick();
      return;
    }
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      onClick();
    }, 300);
  }

  function handleDoubleClick() {
    if (!onDoubleClick) return;
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    onDoubleClick();
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      data-tooltip={label}
      className={active ? styles.toolActive : undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </button>
  );
}

function ComposerToolbar({
  onLinkRequest,
  sourceMode,
  onSourceToggle,
  onSourceTool,
  sourceUndo,
  sourceRedo,
  onSourceHistory,
}: {
  onLinkRequest: () => void;
  sourceMode: boolean;
  onSourceToggle: () => void;
  onSourceTool: (tool: SourceTool, selectionOnly?: boolean) => void;
  sourceUndo: boolean;
  sourceRedo: boolean;
  onSourceHistory: (redo: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [formats, setFormats] = useState({ bold: false, italic: false, underline: false, strikethrough: false });
  const [mobilePanel, setMobilePanel] = useState<"format" | "insert" | null>(null);
  const mobileDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = mobileDialogRef.current;
    if (mobilePanel && !dialog?.open) dialog?.showModal();
    if (!mobilePanel && dialog?.open) dialog.close();
  }, [mobilePanel]);

  function applyMobileTool(action: () => void) {
    mobileDialogRef.current?.close();
    action();
    if (!sourceMode) editor.focus();
  }

  const refreshFormats = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const next = $isRangeSelection(selection) ? {
        bold: selection.hasFormat("bold"),
        italic: selection.hasFormat("italic"),
        underline: selection.hasFormat("underline"),
        strikethrough: selection.hasFormat("strikethrough"),
      } : EMPTY_TEXT_FORMATS;
      // Re-render only on a real change; this runs after every commit.
      setFormats((current) => (
        current.bold === next.bold && current.italic === next.italic
          && current.underline === next.underline && current.strikethrough === next.strikethrough
          ? current
          : next
      ));
    });
  }, [editor]);

  // The toolbar mirrors the selection's *pending* format too, so toggling a format
  // off with a collapsed caret (or clearing it) drops the highlight immediately.
  // A command listener alone misses undo/redo, keyboard shortcuts and typing.
  useEffect(() => mergeRegister(
    editor.registerCommand(CAN_UNDO_COMMAND, (value) => { setCanUndo(value); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_REDO_COMMAND, (value) => { setCanRedo(value); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(SELECTION_CHANGE_COMMAND, () => {
      refreshFormats();
      return false;
    }, COMMAND_PRIORITY_LOW),
    editor.registerUpdateListener(() => refreshFormats()),
  ), [editor, refreshFormats]);

  function run(tool: SourceTool, action: () => void) {
    if (sourceMode) onSourceTool(tool); else action();
  }

  function toggleTextFormat(format: "bold" | "italic" | "underline" | "strikethrough") {
    if (sourceMode) {
      onSourceTool(format);
      return;
    }
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // A double click means "keep formatting for what I type next". Collapse
      // an existing range to its focus edge first so the selected text itself
      // is left to the single-click command, just like a mature word processor.
      if (!selection.isCollapsed()) {
        selection.anchor.set(selection.focus.key, selection.focus.offset, selection.focus.type);
      }
      selection.formatText(format);
    });
    queueMicrotask(refreshFormats);
  }

  function formatSelectionOnly(format: "bold" | "italic" | "underline" | "strikethrough") {
    if (sourceMode) {
      onSourceTool(format, true);
      return;
    }
    const hasSelection = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) && !selection.isCollapsed();
    });
    if (!hasSelection) {
      editor.focus();
      return;
    }
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    queueMicrotask(refreshFormats);
  }

  function clearFormatting() {
    run("clear", () => {
      clearCurrentFormatting(editor);
      setFormats(EMPTY_TEXT_FORMATS);
    });
  }

  function insertPaidGate() {
    run("paid", () => insertPaidGateIntoEditor(editor));
  }

  function insertDivider() {
    run("divider", () => editor.update(() => $insertNodes([$createDividerNode(), $createParagraphNode()])));
  }

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="文章格式工具">
      <div className={styles.desktopToolbar}>
      <ToolbarButton label="撤销" disabled={sourceMode ? !sourceUndo : !canUndo} onClick={() => sourceMode ? onSourceHistory(false) : editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo2 size={18} /></ToolbarButton>
      <ToolbarButton label="重做" disabled={sourceMode ? !sourceRedo : !canRedo} onClick={() => sourceMode ? onSourceHistory(true) : editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo2 size={18} /></ToolbarButton>
      <ToolbarButton label="清除格式" onClick={clearFormatting}><Eraser size={18} /></ToolbarButton>
      <ToolbarButton label="章节" onClick={() => run("h1", () => replaceCurrentBlock(editor, "h1"))}><Heading1 size={18} /></ToolbarButton>
      <ToolbarButton label="加粗" active={formats.bold} onClick={() => formatSelectionOnly("bold")} onDoubleClick={() => toggleTextFormat("bold")}><Bold size={18} /></ToolbarButton>
      <ToolbarButton label="斜体" active={formats.italic} onClick={() => formatSelectionOnly("italic")} onDoubleClick={() => toggleTextFormat("italic")}><Italic size={18} /></ToolbarButton>
      <ToolbarButton label="下划线" active={formats.underline} onClick={() => formatSelectionOnly("underline")} onDoubleClick={() => toggleTextFormat("underline")}><Underline size={18} /></ToolbarButton>
      <ToolbarButton label="删除线" active={formats.strikethrough} onClick={() => formatSelectionOnly("strikethrough")} onDoubleClick={() => toggleTextFormat("strikethrough")}><Strikethrough size={18} /></ToolbarButton>
      <ToolbarButton label="引用" onClick={() => run("quote", () => replaceCurrentBlock(editor, "quote"))}><Quote size={18} /></ToolbarButton>
      <ToolbarButton label="分隔线" onClick={insertDivider}><Minus size={18} /></ToolbarButton>
      <ToolbarButton label="链接" onClick={onLinkRequest}><Link2 size={18} /></ToolbarButton>
      <ToolbarButton label={sourceMode ? "渲染" : "源码"} active={sourceMode} onClick={onSourceToggle}>
        <Code2 size={18} />
      </ToolbarButton>
      <ToolbarButton label="付费分界" onClick={insertPaidGate}><LockKeyhole size={18} /></ToolbarButton>
      </div>
      <div className={styles.mobileToolbar}>
        <ToolbarButton label="文字格式" active={mobilePanel === "format"} onClick={() => setMobilePanel("format")}><Type size={22} /></ToolbarButton>
        <ToolbarButton label={sourceMode ? "渲染" : "更多插入"} active={sourceMode || mobilePanel === "insert"} onClick={() => sourceMode ? onSourceToggle() : setMobilePanel("insert")}>{sourceMode ? <Code2 size={22} /> : <Plus size={22} />}</ToolbarButton>
        <ToolbarButton label="撤销输入" disabled={sourceMode ? !sourceUndo : !canUndo} onClick={() => sourceMode ? onSourceHistory(false) : editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo2 size={22} /></ToolbarButton>
        <ToolbarButton label="重做输入" disabled={sourceMode ? !sourceRedo : !canRedo} onClick={() => sourceMode ? onSourceHistory(true) : editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo2 size={22} /></ToolbarButton>
      </div>
      <dialog ref={mobileDialogRef} className={`${styles.dialog} ${styles.formatDialog}`} aria-label={mobilePanel === "insert" ? "插入内容" : "文字格式"} onClose={() => setMobilePanel(null)}>
        <header><strong>{mobilePanel === "insert" ? "插入内容" : "文字格式"}</strong><button type="button" onClick={() => mobileDialogRef.current?.close()} aria-label="关闭菜单"><X size={19} /></button></header>
        <div className={styles.formatGrid}>
          {mobilePanel === "format" ? <>
            <button type="button" aria-pressed={formats.bold} onClick={() => applyMobileTool(() => toggleTextFormat("bold"))}><Bold size={21} /><span>加粗</span></button>
            <button type="button" aria-pressed={formats.italic} onClick={() => applyMobileTool(() => toggleTextFormat("italic"))}><Italic size={21} /><span>斜体</span></button>
            <button type="button" onClick={() => applyMobileTool(clearFormatting)}><Eraser size={21} /><span>清除格式</span></button>
            <button type="button" onClick={() => applyMobileTool(() => run("h1", () => replaceCurrentBlock(editor, "h1")))}><Heading1 size={21} /><span>章节</span></button>
            <button type="button" onClick={() => applyMobileTool(() => run("paragraph", () => replaceCurrentBlock(editor, "paragraph")))}><Type size={21} /><span>正文</span></button>
            <button type="button" aria-pressed={formats.underline} onClick={() => applyMobileTool(() => toggleTextFormat("underline"))}><Underline size={21} /><span>下划线</span></button>
            <button type="button" aria-pressed={formats.strikethrough} onClick={() => applyMobileTool(() => toggleTextFormat("strikethrough"))}><Strikethrough size={21} /><span>删除线</span></button>
          </> : <>
            <button type="button" onClick={() => { mobileDialogRef.current?.close(); onLinkRequest(); }}><Link2 size={21} /><span>链接</span></button>
            <button type="button" onClick={() => applyMobileTool(() => run("quote", () => replaceCurrentBlock(editor, "quote")))}><Quote size={21} /><span>引用</span></button>
            <button type="button" onClick={() => applyMobileTool(insertDivider)}><Minus size={21} /><span>分隔线</span></button>
            <button type="button" onClick={() => { mobileDialogRef.current?.close(); onSourceToggle(); }}><Code2 size={21} /><span>源码</span></button>
            <button type="button" onClick={() => applyMobileTool(insertPaidGate)}><LockKeyhole size={21} /><span>付费分界</span></button>
          </>}
        </div>
      </dialog>
    </div>
  );
}

function StructuralSafetyPlugin({ onRemoveGate }: { onRemoveGate: (remove: () => void) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
    const node = selection.anchor.getNode();
    const previous = node.getPreviousSibling();
    if (!$isPaidGateNode(previous)) return false;
    event?.preventDefault();
    onRemoveGate(() => previous.remove());
    return true;
  }, COMMAND_PRIORITY_LOW), [editor, onRemoveGate]);
  return null;
}

function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      const text = (event as ClipboardEvent).clipboardData?.getData("text/plain") || "";
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
        if (nodes.length) selection.insertNodes(nodes);
      }, { tag: "markdown-paste" });
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor]);
  return null;
}

function EditorBridge({
  onState,
  onEditor,
  onReady,
}: {
  onState: (state: EditorState, editor: LexicalEditor, tags: Set<string>) => void;
  onEditor: (editor: LexicalEditor) => void;
  onReady: (state: EditorState, editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onEditor(editor);
    onReady(editor.getEditorState(), editor);
  }, [editor, onEditor, onReady]);
  return <OnChangePlugin ignoreSelectionChange onChange={onState} />;
}

function ConflictDialog({
  open,
  onUseServer,
  onKeepLocal,
}: {
  open: boolean;
  onUseServer: () => void;
  onKeepLocal: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={(event) => event.preventDefault()}>
      <h2>检测到其他页面的更新</h2>
      <p>服务器上已有更新版本。请选择保留当前内容为新版本，或载入服务器版本。</p>
      <div className={styles.dialogActions}>
        <button type="button" onClick={onUseServer}>使用服务器版本</button>
        <button type="button" className={styles.primaryButton} onClick={onKeepLocal}>保留当前内容</button>
      </div>
    </dialog>
  );
}

function ComposerConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  dismissLabel = "取消",
  onDismiss,
  secondaryLabel,
  onSecondary,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  dismissLabel?: string;
  onDismiss?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.promptDialog}`}
      onCancel={(event) => { event.preventDefault(); (onDismiss || onCancel)(); }}
    >
      <header className={styles.dialogHeader}><h2>{title}</h2><button type="button" onClick={onDismiss || onCancel} aria-label="关闭"><X size={18} /></button></header>
      <p>{message}</p>
      <div className={styles.dialogActions}>
        {/* The header close button already means "keep editing", so the footer only
            carries the two choices that actually change something. */}
        {dismissLabel ? <button type="button" onClick={onDismiss || onCancel}>{dismissLabel}</button> : null}
        {secondaryLabel && onSecondary ? <button type="button" onClick={onSecondary}>{secondaryLabel}</button> : null}
        <button type="button" className={styles.primaryButton} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

export function OriginalComposerShell({
  initialDraft,
  tags,
  author,
}: {
  initialDraft: OriginalComposerDraft;
  tags: OriginalComposerTag[];
  author: { id: number; displayName: string; avatarPath: string | null };
}) {
  const router = useRouter();
  const [availableTags, setAvailableTags] = useState<OriginalComposerTag[]>(tags);
  const [title, setTitle] = useState(initialDraft.title);
  const [tagIds, setTagIds] = useState<number[]>(initialDraft.tagIds);
  const [price, setPrice] = useState(initialDraft.unlockSodaPrice);
  const [savedAt, setSavedAt] = useState(initialDraft.autosavedAt);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [wordCount, setWordCount] = useState(() => textCount(initialDraft.editorStateJson));
  const [outline, setOutline] = useState<OutlineItem[]>(() => outlineFromEditorJson(initialDraft.editorStateJson));
  const [hasPaidGate, setHasPaidGate] = useState(() => editorHasPaidGate(initialDraft.editorStateJson));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  // Keep the three editor views mutually exclusive. Two independent booleans
  // allowed preview and source state to drift out of sync during fast toggles.
  const [mode, setMode] = useState<ComposerMode>("visual");
  const preview = mode === "preview";
  const sourceMode = mode === "source";
  const [markdown, setMarkdown] = useState("");
  const [sourceWordCount, setSourceWordCount] = useState(0);
  const markdownRef = useRef("");
  const sourceElementRef = useRef<HTMLTextAreaElement>(null);
  const sourceScrollTopRef = useRef(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sourceUndoRef = useRef<string[]>([]);
  const sourceRedoRef = useRef<string[]>([]);
  const sourceHistoryAtRef = useRef(0);
  const sourceWordCountTimerRef = useRef<number | null>(null);
  const sourceDirtyRef = useRef(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [serverConflict, setServerConflict] = useState<OriginalComposerDraft | null>(null);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [recoveryDraft, setRecoveryDraft] = useState<Awaited<ReturnType<typeof readLocalOriginalDraft>>>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const latestEditorStateRef = useRef<EditorState | null>(null);
  const serializedEditorStateRef = useRef<EditorState | null>(null);
  const editorMetadataTimerRef = useRef<number | null>(null);
  const titleElementRef = useRef<HTMLTextAreaElement | null>(null);
  const latestJsonRef = useRef(initialDraft.editorStateJson);
  const savingPromise = useRef<Promise<boolean> | null>(null);
  const revisionRef = useRef(initialDraft.revision);
  const titleRef = useRef(title);
  const tagsRef = useRef(tagIds);
  const priceRef = useRef(price);
  const dirtyRef = useRef(false);
  const explicitSaveRef = useRef(false);
  const editVersionRef = useRef(0);
  const broadcast = useRef<BroadcastChannel | null>(null);
  const insertionSelectionRef = useRef<SelectionBookmark | null>(null);
  const localRecoveryVersionRef = useRef(0);
  const persistedLocalVersionRef = useRef(0);
  const exitHref = initialDraft.articleId === null ? "/original/mine?view=drafts" : "/original/mine";

  useEffect(() => {
    if (!message || settingsOpen || message.endsWith("中…")) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message, settingsOpen]);

  useEffect(() => {
    titleRef.current = title;
    tagsRef.current = tagIds;
    priceRef.current = price;
  }, [price, tagIds, title]);

  useLayoutEffect(() => {
    const element = titleElementRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);

  useEffect(() => {
    editorRef.current?.setEditable(!preview && !sourceMode && !publishing);
  }, [preview, sourceMode, publishing]);

  const flushMarkdown = useCallback(() => {
    const editor = editorRef.current;
    if (!sourceDirtyRef.current || !editor) return;
    editor.update(() => {
      $convertFromMarkdownString(markdownRef.current, ORIGINAL_MARKDOWN_TRANSFORMERS);
    }, { discrete: true, tag: ["source-sync", SKIP_DOM_SELECTION_TAG] });
    latestEditorStateRef.current = editor.getEditorState();
    serializedEditorStateRef.current = null;
    sourceDirtyRef.current = false;
  }, []);

  const captureLatestEditorSnapshot = useCallback(() => {
    const state = latestEditorStateRef.current || editorRef.current?.getEditorState() || null;
    if (!state) return latestJsonRef.current;
    latestEditorStateRef.current = state;
    if (serializedEditorStateRef.current !== state) {
      latestJsonRef.current = JSON.stringify(state.toJSON());
      serializedEditorStateRef.current = state;
    }
    return latestJsonRef.current;
  }, []);

  const syncEditorSnapshotToUi = useCallback(() => {
    return captureLatestEditorSnapshot();
  }, [captureLatestEditorSnapshot]);

  const applyEditorMetadata = useCallback((state: EditorState) => {
    const metadata = editorMetadata(state);
    setWordCount(metadata.wordCount);
    setOutline(metadata.outline);
    setHasPaidGate(metadata.hasPaidGate);
  }, []);

  const scheduleEditorMetadata = useCallback((state: EditorState) => {
    latestEditorStateRef.current = state;
    if (editorMetadataTimerRef.current !== null) window.clearTimeout(editorMetadataTimerRef.current);
    editorMetadataTimerRef.current = window.setTimeout(() => {
      editorMetadataTimerRef.current = null;
      const run = () => applyEditorMetadata(state);
      const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(run, { timeout: 500 }); else run();
    }, EDITOR_METADATA_DEBOUNCE_MS);
  }, [applyEditorMetadata]);

  useEffect(() => () => {
    if (editorMetadataTimerRef.current !== null) window.clearTimeout(editorMetadataTimerRef.current);
    if (sourceWordCountTimerRef.current !== null) window.clearTimeout(sourceWordCountTimerRef.current);
  }, []);

  function updateSource(value: string, history = true) {
    if (value === markdownRef.current) return;
    if (history) {
      const now = performance.now();
      if (now - sourceHistoryAtRef.current > 700) {
        sourceUndoRef.current = [...sourceUndoRef.current.slice(-19), markdownRef.current];
        sourceHistoryAtRef.current = now;
      }
      sourceRedoRef.current = [];
    }
    markdownRef.current = value;
    sourceDirtyRef.current = true;
    setMarkdown(value);
    if (sourceWordCountTimerRef.current !== null) window.clearTimeout(sourceWordCountTimerRef.current);
    sourceWordCountTimerRef.current = window.setTimeout(() => {
      sourceWordCountTimerRef.current = null;
      setSourceWordCount(countOriginalMarkdownCharacters(markdownRef.current));
    }, EDITOR_METADATA_DEBOUNCE_MS);
    markDirty();
  }

  function focusSource(start: number, end = start) {
    requestAnimationFrame(() => {
      sourceElementRef.current?.focus();
      sourceElementRef.current?.setSelectionRange(start, end);
    });
  }

  function sourceTool(tool: SourceTool, selectionOnly = false) {
    const input = sourceElementRef.current;
    if (!input || publishing) return;
    if (selectionOnly && input.selectionStart === input.selectionEnd) {
      input.focus();
      return;
    }
    if (tool === "paid" && markdownRef.current.includes("<!-- original-paid -->")) {
      setMessage("文章只能有一个付费分界");
      return;
    }
    const result = editMarkdownSource(markdownRef.current, input.selectionStart, input.selectionEnd, tool);
    updateSource(result.value);
    focusSource(result.start, result.end);
  }

  function sourceHistory(redo: boolean) {
    const from = redo ? sourceRedoRef.current : sourceUndoRef.current;
    const to = redo ? sourceUndoRef.current : sourceRedoRef.current;
    const value = from.pop();
    if (value === undefined) return;
    to.push(markdownRef.current);
    updateSource(value, false);
    focusSource(value.length);
  }

  function insertSource(text: string) {
    const input = sourceElementRef.current;
    const start = input?.selectionStart ?? markdownRef.current.length;
    const end = input?.selectionEnd ?? start;
    updateSource(markdownRef.current.slice(0, start) + text + markdownRef.current.slice(end));
    focusSource(start + text.length);
  }

  function changeMode(nextMode: ComposerMode) {
    if (nextMode === mode) return;
    if (nextMode === "preview") setOutlineOpen(false);
    const workspaceScrollTop = workspaceRef.current?.scrollTop ?? 0;
    sourceScrollTopRef.current = sourceElementRef.current?.scrollTop ?? sourceScrollTopRef.current;
    const restoreWorkspaceScroll = () => requestAnimationFrame(() => {
      if (workspaceRef.current) workspaceRef.current.scrollTop = workspaceScrollTop;
      if (nextMode === "source" && sourceElementRef.current) sourceElementRef.current.scrollTop = sourceScrollTopRef.current;
    });

    // A Markdown draft may contain GFM that visual mode deliberately leaves
    // untouched (for example a table). Source and reader preview can switch
    // between those two representations without first normalizing it through
    // the rich-text document.
    if (sourceDirtyRef.current && (nextMode === "source" || nextMode === "preview")) {
      setMarkdown(markdownRef.current);
      setLinkPopoverOpen(false);
      setMode(nextMode);
      restoreWorkspaceScroll();
      return;
    }

    // A visual edit needs a Lexical document, so only this path commits the
    // pending source value. This makes source → preview lossless.
    flushMarkdown();
    const editor = editorRef.current;
    if (editor) {
      commitBufferedMarkdown(editor);
      latestEditorStateRef.current = editor.getEditorState();
      serializedEditorStateRef.current = null;
      syncEditorSnapshotToUi();
    }

    // Both source and preview are derived from the same canonical Lexical
    // document. Refresh the Markdown snapshot on every entry so neither view
    // can retain stale text from a previous mode.
    if (nextMode === "source" || nextMode === "preview") {
      const source = editor?.getEditorState().read(() => $convertToMarkdownString(ORIGINAL_MARKDOWN_TRANSFORMERS)) || "";
      markdownRef.current = source;
      setMarkdown(source);
      setSourceWordCount(countOriginalMarkdownCharacters(source));
      if (nextMode === "source") {
        sourceUndoRef.current = [];
        sourceRedoRef.current = [];
      }
    }

    setLinkPopoverOpen(false);
    setMode(nextMode);
    restoreWorkspaceScroll();
  }

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`novel-reader:original-draft:${initialDraft.id}`);
    broadcast.current = channel;
    channel.onmessage = (event) => {
      const nextRevision = Number((event.data as { revision?: unknown })?.revision);
      if (Number.isSafeInteger(nextRevision) && nextRevision > revisionRef.current && dirtyRef.current) {
        setSaveState("conflict");
      }
    };
    return () => channel.close();
  }, [initialDraft.id]);

  const persistLocal = useCallback(async () => {
    flushMarkdown();
    const json = captureLatestEditorSnapshot();
    await writeLocalOriginalDraft({
      draftId: initialDraft.id,
      revision: revisionRef.current,
      title: titleRef.current,
      editorStateJson: json,
      tagIds: tagsRef.current,
      unlockSodaPrice: priceRef.current,
      savedAt: Date.now(),
    });
  }, [initialDraft.id, flushMarkdown, captureLatestEditorSnapshot]);

  const saveToServer = useCallback(async (force = false): Promise<boolean> => {
    if (savingPromise.current) {
      const succeeded = await savingPromise.current;
      if (!succeeded || !dirtyRef.current) return succeeded;
      if (!force) return false;
    }
    if (!dirtyRef.current && !force) return true;
    const run = (async () => {
      setSaveState("saving");
      try {
        flushMarkdown();
        captureLatestEditorSnapshot();
        const savingVersion = editVersionRef.current;
        const payload = JSON.stringify({
          revision: revisionRef.current,
          title: titleRef.current,
          editorStateJson: latestJsonRef.current,
          tagIds: tagsRef.current,
          unlockSodaPrice: priceRef.current,
        });
        await persistLocal();
        if (!navigator.onLine) {
          setSaveState("offline");
          return false;
        }
        const response = await fetch(`/api/original/drafts/${initialDraft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
          body: payload,
          credentials: "same-origin",
        });
        const result = await response.json() as { draft?: OriginalComposerDraft; error?: string; conflict?: boolean };
        if (response.status === 409 && result.draft) {
          setServerConflict(result.draft);
          setSaveState("conflict");
          return false;
        }
        if (!response.ok || !result.draft) throw new Error(result.error || "保存失败");
        revisionRef.current = result.draft.revision;
        setSavedAt(result.draft.autosavedAt);
        dirtyRef.current = editVersionRef.current !== savingVersion;
        setSaveState(dirtyRef.current ? "dirty" : "saved");
        broadcast.current?.postMessage({ revision: result.draft.revision });
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "保存失败");
        setSaveState(navigator.onLine ? "error" : "offline");
        return false;
      } finally {
        savingPromise.current = null;
      }
    })();
    savingPromise.current = run;
    const succeeded = await run;
    if (!succeeded) return false;
    if (force && dirtyRef.current) return saveToServer(true);
    return !dirtyRef.current;
  }, [initialDraft.id, persistLocal, flushMarkdown, captureLatestEditorSnapshot]);

  const markDirty = useCallback(() => {
    editVersionRef.current += 1;
    dirtyRef.current = true;
    localRecoveryVersionRef.current = editVersionRef.current;
    setSaveState((current) => current === "conflict" ? current : "dirty");
  }, []);

  // A local recovery copy is the safety net for every way of leaving the page
  // (browser Back, tab close, crash). It only touches IndexedDB, so it is cheap
  // enough to run while typing; the server copy still waits for an explicit save.
  useEffect(() => {
    let timer: number | null = null;
    const flushLocal = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!dirtyRef.current) return;
      void persistLocal().catch(() => {
        // A blocked or full store must never interrupt writing.
      });
    };
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        flushLocal();
      }, LOCAL_RECOVERY_DEBOUNCE_MS);
    };
    const poll = window.setInterval(() => {
      if (dirtyRef.current && localRecoveryVersionRef.current !== persistedLocalVersionRef.current) {
        persistedLocalVersionRef.current = localRecoveryVersionRef.current;
        schedule();
      }
    }, LOCAL_RECOVERY_POLL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") flushLocal();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushLocal);
    return () => {
      window.clearInterval(poll);
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushLocal);
    };
  }, [persistLocal]);

  const manualSave = useCallback(async () => {
    const saved = await saveToServer(true);
    if (saved) explicitSaveRef.current = true;
  }, [saveToServer]);

  // Unsaved work is guarded by `beforeunload` (tab close / reload) plus the local
  // recovery copy that `persistLocal` keeps, never by trapping browser history.
  // An earlier version pushed a duplicate entry on mount and then called
  // `history.back()` again from its own `popstate` handler, so a single Back press
  // consumed two entries and left the dead /original/write/<id> URL behind for the
  // exit `replace` to skip past — which is why Back appeared to jump several pages.
  // Armed only while there is something to lose. A listener that is always attached
  // makes Chrome log a blocked-confirmation error on every clean unload.
  const hasUnsavedWork = saveState === "dirty" || saveState === "error"
    || saveState === "offline" || saveState === "conflict";
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [hasUnsavedWork]);

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void manualSave();
      }
    };
    window.addEventListener("keydown", saveShortcut);
    return () => {
      window.removeEventListener("keydown", saveShortcut);
    };
  }, [manualSave]);

  useEffect(() => {
    void readLocalOriginalDraft(initialDraft.id).then((local) => {
      if (!local || local.savedAt <= initialDraft.updatedAt || !local.editorStateJson) return;
      if (local.title === initialDraft.title && local.editorStateJson === initialDraft.editorStateJson
        && local.unlockSodaPrice === initialDraft.unlockSodaPrice
        && JSON.stringify(local.tagIds) === JSON.stringify(initialDraft.tagIds)) return;
      setRecoveryDraft(local);
    });
  }, [initialDraft.id, initialDraft.updatedAt, initialDraft.title, initialDraft.editorStateJson, initialDraft.unlockSodaPrice, initialDraft.tagIds]);

  const restoreLocalDraft = useCallback(() => {
    const local = recoveryDraft;
    if (!local) return;
    titleRef.current = local.title;
    tagsRef.current = local.tagIds;
    priceRef.current = local.unlockSodaPrice;
    latestJsonRef.current = local.editorStateJson;
    serializedEditorStateRef.current = null;
    setTitle(local.title);
    setTagIds(local.tagIds);
    setPrice(local.unlockSodaPrice);
    const editor = editorRef.current;
    if (editor) {
      const state = editor.parseEditorState(local.editorStateJson);
      latestEditorStateRef.current = state;
      editor.setEditorState(state, { tag: "source-sync" });
      applyEditorMetadata(state);
      sourceDirtyRef.current = false;
      if (sourceMode) {
        const source = state.read(() => $convertToMarkdownString(ORIGINAL_MARKDOWN_TRANSFORMERS));
        markdownRef.current = source;
        setMarkdown(source);
        setSourceWordCount(countOriginalMarkdownCharacters(source));
      }
    }
    setRecoveryDraft(null);
    markDirty();
  }, [applyEditorMetadata, markDirty, recoveryDraft, sourceMode]);

  const discardLocalDraft = useCallback(() => {
    setRecoveryDraft(null);
    void deleteLocalOriginalDraft(initialDraft.id);
  }, [initialDraft.id]);

  const handleEditorState = useCallback((state: EditorState, editor: LexicalEditor, tags: Set<string>) => {
    latestEditorStateRef.current = state;
    if (editor.isComposing()) return;
    scheduleEditorMetadata(state);
    // Source synchronization and the final buffered-markdown commit are
    // normalization steps, not user edits. They must not turn a clean draft
    // dirty merely because the user changed views.
    if (!tags.has("source-sync") && !tags.has("buffered-markdown")) markDirty();
  }, [markDirty, scheduleEditorMetadata]);

  const handleEditorReady = useCallback((_state: EditorState, editor: LexicalEditor) => {
    normalizeMarkdownParagraphs(editor);
    const normalizedState = editor.getEditorState();
    latestEditorStateRef.current = normalizedState;
    serializedEditorStateRef.current = null;
    applyEditorMetadata(normalizedState);
    syncEditorSnapshotToUi();
    if (!initialDraft.editorStateJson && initialDraft.legacyMarkdown.trim()) markDirty();
  }, [applyEditorMetadata, initialDraft.editorStateJson, initialDraft.legacyMarkdown, markDirty, syncEditorSnapshotToUi]);

  const handleEditorMount = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
  }, []);

  const removeGate = useCallback((remove: () => void) => {
    remove();
    editorRef.current?.focus();
  }, []);

  const removeUncommittedDraft = useCallback(async () => {
    await deleteLocalOriginalDraft(initialDraft.id);
    if (initialDraft.articleId !== null) return;
    const response = await fetch(`/api/original/drafts/${initialDraft.id}`, {
      method: "DELETE",
      headers: { "X-Novel-Mutation": "1" },
      credentials: "same-origin",
    });
    if (!response.ok && response.status !== 404) throw new Error("草稿退出清理失败，请重试");
  }, [initialDraft.articleId, initialDraft.id]);

  const exitWithoutSaving = useCallback(async () => {
    try {
      await removeUncommittedDraft();
      setExitPromptOpen(false);
      router.replace(exitHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败，请重试");
    }
  }, [exitHref, removeUncommittedDraft, router]);

  const saveAndExit = useCallback(async () => {
    const saved = await saveToServer(true);
    if (!saved) return;
    explicitSaveRef.current = true;
    setExitPromptOpen(false);
    router.replace(exitHref);
  }, [exitHref, router, saveToServer]);

  const requestExit = useCallback(() => {
    if (publishing) return;
    if (dirtyRef.current || !explicitSaveRef.current) {
      setExitPromptOpen(true);
      return;
    }
    router.replace(exitHref);
  }, [exitHref, publishing, router]);

  const openLinkPopover = useCallback(() => {
    if (sourceMode) {
      const input = sourceElementRef.current;
      const selected = markdownRef.current.slice(input?.selectionStart ?? 0, input?.selectionEnd ?? 0);
      setLinkText(selected);
    } else {
      insertionSelectionRef.current = editorSelectionBookmark(editorRef.current);
      editorRef.current?.getEditorState().read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          setLinkText(selection.getTextContent());
        } else {
          setLinkText("");
        }
      });
    }
    setLinkUrl("");
    setLinkPopoverOpen((prev) => !prev);
  }, [sourceMode]);

  const confirmInlineLink = useCallback((text: string, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    if (!/^(?:https?:\/\/|mailto:|\/)/iu.test(trimmedUrl)) {
      setMessage("链接需以 http://、https://、mailto: 或站内路径开头");
      return;
    }
    const label = text.trim() || trimmedUrl;
    if (sourceMode) {
      insertSource(`[${label}](${trimmedUrl})`);
    } else {
      editorRef.current?.update(() => {
        restoreEditorSelection(insertionSelectionRef.current);
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          if (selection.isCollapsed() || text.trim() !== selection.getTextContent()) {
            const textNode = $createTextNode(label);
            const linkNode = $createLinkNode(trimmedUrl);
            linkNode.append(textNode);
            selection.insertNodes([linkNode]);
          } else {
            editorRef.current?.dispatchCommand(TOGGLE_LINK_COMMAND, trimmedUrl);
          }
        }
      });
      editorRef.current?.focus();
    }
    insertionSelectionRef.current = null;
    setLinkPopoverOpen(false);
  }, [sourceMode, insertSource]);

  const createTag = useCallback(async (name: string): Promise<OriginalComposerTag> => {
    const response = await fetch("/api/original/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
      body: JSON.stringify({ name }),
      credentials: "same-origin",
    });
    const result = await response.json().catch(() => ({})) as { tag?: OriginalComposerTag; error?: string };
    if (!response.ok || !result.tag) throw new Error(result.error || "标签创建失败");
    setAvailableTags((current) => {
      if (current.some((tag) => tag.id === result.tag!.id)) return current;
      return [...current, result.tag!].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    });
    return result.tag;
  }, []);

  async function publish() {
    setMessage("");
    setPublishing(true);
    try {
      flushMarkdown();
      if (editorRef.current) {
        commitBufferedMarkdown(editorRef.current);
        latestEditorStateRef.current = editorRef.current.getEditorState();
        serializedEditorStateRef.current = null;
      }
      captureLatestEditorSnapshot();
      const cleanTitle = titleRef.current.normalize("NFKC").trim();
      if (!cleanTitle) throw new Error("请先填写文章标题");
      if (Array.from(cleanTitle).length > 100) throw new Error("标题最多 100 个字，请缩短后再发布");
      const document = serializeOriginalEditorState(latestJsonRef.current);
      if (document.publicWordCount < 1) throw new Error("请填写正文；付费文章的公开部分至少需要 1 个字");
      if (priceRef.current > 0 && document.paidGateCount !== 1) throw new Error("付费文章需要一个付费分界，请点击工具栏的锁形图标插入");
      if (priceRef.current > 0 && document.paidWordCount < 1) throw new Error("付费分界后还没有正文，请先填写付费内容");
      if (priceRef.current === 0 && document.paidGateCount > 0) throw new Error("正文含付费分界，请选择付费阅读，或移除分界后免费发布");
      const saved = await saveToServer(true);
      if (!saved) throw new Error("请先解决草稿保存问题");
      explicitSaveRef.current = true;
      const mutationId = randomId("publish");
      const response = await fetch(`/api/original/drafts/${initialDraft.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ revision: revisionRef.current, mutationId }),
        credentials: "same-origin",
      });
      const result = await response.json() as { slug?: string; error?: string };
      if (!response.ok || !result.slug) throw new Error(result.error || "发布失败");
      await deleteLocalOriginalDraft(initialDraft.id);
      try {
        for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
          const key = sessionStorage.key(index);
          if (key?.startsWith("novel-reader:original-draft-launch:")) sessionStorage.removeItem(key);
        }
      } catch {
        // Session storage may be blocked; a published draft remains editable by its direct URL.
      }
      router.replace(`/original/${encodeURIComponent(result.slug)}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  const initialConfig = useMemo(() => ({
    namespace: `OriginalComposer-${initialDraft.id}`,
    editorState: initialEditorState(initialDraft),
    onError(error: Error) {
      console.error("Original editor error", error);
      setMessage("编辑器发生错误，本机恢复副本仍会保留");
    },
    theme: {
      paragraph: styles.editorParagraph,
      heading: {
        h1: styles.editorH1,
        h2: styles.editorH2,
        h3: styles.editorH3,
        h4: styles.editorH3,
        h5: styles.editorH3,
        h6: styles.editorH3,
      },
      quote: styles.editorQuote,
      list: {
        ul: styles.editorList,
        ol: styles.editorList,
        checklist: styles.editorChecklist,
        listitem: styles.editorListItem,
        listitemChecked: styles.editorListItemChecked,
        listitemUnchecked: styles.editorListItemUnchecked,
      },
      link: styles.editorLink,
      text: {
        bold: styles.bold,
        italic: styles.italic,
        underline: styles.underline,
        strikethrough: styles.strikethrough,
        code: styles.inlineCode,
      },
      code: styles.editorCode,
      tableScrollableWrapper: styles.tableScrollableWrapper,
      paidGate: styles.paidGate,
      divider: styles.divider,
      image: styles.image,
    },
    nodes: [
      HeadingNode,
      OriginalHeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      CodeNode,
      TableNode,
      TableRowNode,
      TableCellNode,
      PaidGateNode,
      DividerNode,
      OriginalImageNode,
    ],
  }), [initialDraft]);

  const displayStatus = statusText(saveState, savedAt);

  const selectedTags = useMemo(() => {
    return tagIds
      .map((id) => availableTags.find((tag) => tag.id === id))
      .filter((tag): tag is OriginalComposerTag => Boolean(tag));
  }, [tagIds, availableTags]);

  const previewDoc = useMemo(() => {
    if (!preview) return { publicMarkdown: "", paidMarkdown: "", fullMarkdown: "" };
    const raw = sourceMode || sourceDirtyRef.current
      ? markdown
      : editorRef.current?.getEditorState().read(() => $convertToMarkdownString(ORIGINAL_MARKDOWN_TRANSFORMERS)) || markdown;
    const parts = raw.split(/(?:<!--\s*paid-gate\s*-->|NOVEL_READER_PAID_GATE_NODE_V1|<!--\s*original-paid\s*-->)/iu);
    const publicMarkdown = (parts[0] || "").trim();
    const paidMarkdown = (parts[1] || "").trim();
    return {
      publicMarkdown,
      paidMarkdown,
      fullMarkdown: paidMarkdown ? `${publicMarkdown}\n\n${paidMarkdown}` : publicMarkdown,
    };
  }, [preview, sourceMode, markdown]);
  const displayedWordCount = sourceDirtyRef.current ? sourceWordCount : wordCount;

  return (
    <main className={styles.shell} data-preview={preview} data-source={sourceMode}>
      <LexicalComposer initialConfig={initialConfig}>
        {!preview ? <header className={styles.topBar}>
          <button type="button" className={styles.backButton} aria-label="返回我的原创" title="返回我的原创" disabled={publishing} onClick={requestExit}>
            <ChevronLeft size={22} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <span className={styles.workspaceTitle} aria-live="polite">{preview ? "文章预览" : sourceMode ? "Markdown 源码" : "写文章"}</span>
          <div className={styles.topBarActions}>
            <button type="button" className={`${styles.actionButton} ${styles.outlineButton}`} aria-label="目录" title="目录" aria-expanded={outlineOpen} onClick={() => setOutlineOpen((open) => !open)}>
              <List size={16} /><span>目录</span>
            </button>
            <button type="button" className={`${styles.actionButton} ${styles.settingsButton}`} aria-label="文章设置" title="文章设置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><span>设置</span></button>
            <button type="button" className={`${styles.actionButton} ${styles.publishButton} ${styles.topPublishButton}`} disabled={publishing} onClick={() => void publish()}>
              发布
            </button>
          </div>
        </header> : null}

        {!preview ? <ComposerToolbar
          onSourceTool={sourceTool}
          sourceUndo={sourceUndoRef.current.length > 0}
          sourceRedo={sourceRedoRef.current.length > 0}
          onSourceHistory={sourceHistory}
          onLinkRequest={openLinkPopover}
          sourceMode={sourceMode}
          onSourceToggle={() => changeMode(sourceMode ? "visual" : "source")}
        /> : null}

        {!preview && linkPopoverOpen ? (
          <div className={styles.inlineLinkPopover} role="dialog" aria-label="插入链接">
            <Link2 className={styles.inlineLinkIcon} size={16} aria-hidden="true" />
            <input
              type="text"
              className={styles.inlineLinkTextInput}
              placeholder="链接文字"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmInlineLink(linkText, linkUrl);
                } else if (e.key === "Escape") {
                  setLinkPopoverOpen(false);
                }
              }}
            />
            <input
              type="url"
              className={styles.inlineLinkUrlInput}
              placeholder="https:// 或站内路径"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmInlineLink(linkText, linkUrl);
                } else if (e.key === "Escape") {
                  setLinkPopoverOpen(false);
                }
              }}
            />
            <button
              type="button"
              className={styles.inlineLinkSubmit}
              onClick={() => confirmInlineLink(linkText, linkUrl)}
              aria-label="确认插入链接"
              title="确认"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className={styles.inlineLinkClose}
              onClick={() => setLinkPopoverOpen(false)}
              aria-label="取消"
              title="取消"
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        <div ref={workspaceRef} className={styles.workspace}>
          {preview ? (
            <div className={`readerShell originalReaderShell ${styles.readerPreviewSurface}`} data-reader-theme="app">
              <button type="button" className={styles.previewExitButton} aria-label="返回编辑" title="返回编辑" onClick={() => changeMode("visual")}>
                <ChevronLeft size={22} strokeWidth={1.9} aria-hidden="true" /><span>返回编辑</span>
              </button>
              <button type="button" className={styles.previewOutlineButton} aria-label="目录" title="目录" aria-expanded={outlineOpen} onClick={() => setOutlineOpen((open) => !open)}>
                <List size={18} aria-hidden="true" /><span>目录</span>
              </button>
              <article className="readerPage originalDetail">
              <header className="originalDetailHeader">
                <div className="readerTitle originalDetailTitleLine"><h1>{title || "未命名文章"}</h1></div>
                {selectedTags.length ? (
                  <nav className="readerTagLinks originalDetailTags" aria-label="文章标签">
                    {selectedTags.map((tag) => (
                      <span key={tag.id} className="tagChip contentTagLink">{tag.name}</span>
                    ))}
                  </nav>
                ) : null}
                <div className="originalDetailIdentity">
                  <UserAvatar className="originalDetailAuthorAvatar" userId={author.id} displayName={author.displayName} avatarPath={author.avatarPath} />
                  <div>
                    <span className="originalAuthorLink">{author.displayName}</span>
                    <p>
                      <time dateTime={new Date(initialDraft.updatedAt).toISOString()}>发布于 刚刚</time>
                      <span>{`${displayedWordCount.toLocaleString("zh-CN")} 字`}</span>
                    </p>
                  </div>
                </div>
              </header>
              <div className="originalReadingLayout">
                <div className="originalReaderStage">
                  <div className="readerText originalBody">
                    <OriginalMarkdown>{price > 0 && hasPaidGate ? previewDoc.publicMarkdown : previewDoc.fullMarkdown}</OriginalMarkdown>
                  </div>
                </div>
              </div>
              {price > 0 && hasPaidGate ? (
                <section className="originalGate" aria-live="polite">
                  <LockKeyhole size={23} aria-hidden="true" />
                  <strong>解锁完整内容 · {price} 苏打</strong>
                  <button type="button" className="originalPrimaryButton">解锁</button>
                </section>
              ) : null}
              </article>
            </div>
          ) : null}

          <article className={styles.paper} hidden={preview}>
            <textarea
              ref={titleElementRef}
              className={styles.titleInput}
              value={title}
              rows={1}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="请输入标题"
              aria-label="文章标题"
              readOnly={preview || publishing}
              onChange={(event) => { titleRef.current = event.target.value; setTitle(event.target.value); markDirty(); }}
            />
            {sourceMode ? <textarea ref={sourceElementRef} className={styles.markdownInput} aria-label="Markdown 正文" value={markdown} spellCheck={false} readOnly={publishing} placeholder="# 章节标题" onKeyDown={(event) => {
              if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                const result = event.shiftKey
                  ? applyTextareaOutdent(markdownRef.current, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
                  : applyTextareaIndent(markdownRef.current, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, "  ");
                updateSource(result.value);
                focusSource(result.selectionStart, result.selectionEnd);
                return;
              }
              if ((event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && /^(z|y)$/i.test(event.key)) {
                event.preventDefault();
                sourceHistory(event.shiftKey || event.key.toLowerCase() === "y");
              }
            }} onChange={(event) => {
              updateSource(event.target.value);
            }} /> : null}
            <div className={styles.editorFrame} hidden={sourceMode}>
              <RichTextPlugin
                contentEditable={<ContentEditable className={styles.contentEditable} aria-label="文章正文" />}
                placeholder={<div className={styles.placeholder}>请输入正文</div>}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <CheckListPlugin />
              <LinkPlugin />
              <TablePlugin hasCellMerge={false} hasCellBackgroundColor={false} hasHorizontalScroll />
              <EditorTabPlugin />
              <BufferedMarkdownPlugin />
              <StructuralSafetyPlugin onRemoveGate={removeGate} />
              <MarkdownPastePlugin />
              <EditorBridge
                onState={handleEditorState}
                onEditor={handleEditorMount}
                onReady={handleEditorReady}
              />
            </div>
          </article>
          {outlineOpen ? (
            <aside className={`${styles.outline} ${preview ? styles.previewOutline : ""} ${outlineOpen ? styles.outlineOpen : ""}`} aria-label="文章目录">
              <header><strong>目录</strong><button type="button" onClick={() => setOutlineOpen(false)} aria-label="关闭目录"><X size={18} /></button></header>
              {outline.length ? <nav>
                {outline.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    className={item.level > 1 ? styles.outlineLevel2 : undefined}
                    onClick={() => {
                      document.getElementById(preview ? `original-heading-${index + 1}` : item.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      if (preview) setOutlineOpen(false);
                    }}
                  >
                    {item.paid ? <LockKeyhole size={13} aria-hidden="true" /> : null}{item.text}
                  </button>
                ))}
              </nav> : <p className={styles.outlineEmpty}>添加标题后，这里会生成目录。</p>}
            </aside>
          ) : null}
        </div>

        {!preview ? <footer className={styles.statusBar}>
          <button type="button" className={styles.saveStatusButton} title="保存草稿（Ctrl / ⌘ + S）" disabled={publishing || saveState === "saving"} onClick={() => void manualSave()}>
            {saveState === "saved" || saveState === "clean" ? <Check size={15} /> : <Save size={15} />}
            <span role="status">{displayStatus}</span>
          </button>
          <span className={styles.wordCount}>{displayedWordCount.toLocaleString("zh-CN")} 字</span>
          <div className={styles.statusActions}>
            <button type="button" className={`${styles.actionButton} ${styles.previewButton}`} aria-label={preview ? "继续编辑" : "预览"} title={preview ? "继续编辑" : "预览"} disabled={publishing} onClick={() => changeMode(preview ? "visual" : "preview")}>
              <Eye size={15} aria-hidden="true" />
              <span>{preview ? "继续编辑" : "预览"}</span>
            </button>
            <button type="button" className={`${styles.actionButton} ${styles.publishButton} ${styles.bottomPublishButton}`} disabled={publishing} onClick={() => void publish()}>
              发布
            </button>
          </div>
        </footer> : null}

      </LexicalComposer>

      {message ? <div className={styles.notice} role="status">{message}</div> : null}

      <PublishDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tags={availableTags}
        onCreateTag={createTag}
        selectedTagIds={tagIds}
        onTagIds={(values) => { tagsRef.current = values; setTagIds(values); markDirty(); }}
        price={price}
        onPrice={(value) => { priceRef.current = value; setPrice(value); markDirty(); }}
        hasPaidGate={hasPaidGate}
        publishing={publishing}
        onInsertPaidGate={() => {
          setSettingsOpen(false);
          if (sourceMode) sourceTool("paid");
          else if (editorRef.current) {
            insertPaidGateIntoEditor(editorRef.current);
            editorRef.current.focus();
          }
        }}
        onPublish={publish}
        errorMessage={message}
      />

      <ConflictDialog
        open={Boolean(serverConflict)}
        onUseServer={() => {
          const draft = serverConflict;
          if (!draft) return;
          revisionRef.current = draft.revision;
          latestJsonRef.current = draft.editorStateJson;
          serializedEditorStateRef.current = null;
          titleRef.current = draft.title;
          tagsRef.current = draft.tagIds;
          priceRef.current = draft.unlockSodaPrice;
          setTitle(draft.title);
          setTagIds(draft.tagIds);
          setPrice(draft.unlockSodaPrice);
          const editor = editorRef.current;
          if (draft.editorStateJson && editor) {
            const state = editor.parseEditorState(draft.editorStateJson);
            latestEditorStateRef.current = state;
            editor.setEditorState(state, { tag: "source-sync" });
            applyEditorMetadata(state);
            sourceDirtyRef.current = false;
            if (sourceMode) {
              const source = state.read(() => $convertToMarkdownString(ORIGINAL_MARKDOWN_TRANSFORMERS));
              markdownRef.current = source;
              setMarkdown(source);
              setSourceWordCount(countOriginalMarkdownCharacters(source));
            }
          }
          dirtyRef.current = false;
          setSaveState("saved");
          setServerConflict(null);
          void deleteLocalOriginalDraft(initialDraft.id);
        }}
        onKeepLocal={() => {
          const draft = serverConflict;
          if (!draft) return;
          revisionRef.current = draft.revision;
          setServerConflict(null);
          dirtyRef.current = true;
          void saveToServer(true);
        }}
      />

      <ComposerConfirmDialog
        open={exitPromptOpen}
        title="保存为草稿？"
        message="保存后可在“我的原创 · 草稿”继续编辑。"
        confirmLabel="保存并退出"
        dismissLabel=""
        secondaryLabel="不保存"
        onDismiss={() => setExitPromptOpen(false)}
        onSecondary={() => void exitWithoutSaving()}
        onCancel={() => setExitPromptOpen(false)}
        onConfirm={() => void saveAndExit()}
      />

      <ComposerConfirmDialog
        open={Boolean(recoveryDraft)}
        title="恢复本机草稿？"
        message="发现比服务器更新的本机恢复副本。恢复后可以继续编辑并保存。"
        confirmLabel="恢复草稿"
        onCancel={discardLocalDraft}
        onConfirm={restoreLocalDraft}
      />
    </main>
  );
}

function PublishDialog({
  open,
  onClose,
  tags,
  selectedTagIds,
  onTagIds,
  onCreateTag,
  price,
  onPrice,
  hasPaidGate,
  publishing,
  onInsertPaidGate,
  onPublish,
  errorMessage,
}: {
  open: boolean;
  onClose: () => void;
  tags: OriginalComposerTag[];
  selectedTagIds: number[];
  onTagIds: (ids: number[]) => void;
  onCreateTag: (name: string) => Promise<OriginalComposerTag>;
  price: number;
  onPrice: (price: number) => void;
  hasPaidGate: boolean;
  publishing: boolean;
  onInsertPaidGate: () => void;
  onPublish: () => Promise<void>;
  errorMessage: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [tagError, setTagError] = useState("");
  const [tagCreating, setTagCreating] = useState(false);
  const [knownTags, setKnownTags] = useState<OriginalComposerTag[]>(tags);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagPickerLoading, setTagPickerLoading] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState("");
  const allTagsLoadedRef = useRef(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
    if (open) {
      setTagInput("");
      setTagError("");
      setTagPickerOpen(false);
      setDrawerSearch("");
    }
  }, [open]);
  useEffect(() => {
    setKnownTags((current) => {
      const merged = new Map(current.map((tag) => [tag.id, tag]));
      tags.forEach((tag) => merged.set(tag.id, tag));
      return [...merged.values()];
    });
  }, [tags]);
  const paid = price > 0;

  function selectTag(tag: OriginalComposerTag, clearInput = true) {
    if (selectedTagIds.includes(tag.id)) {
      onTagIds(selectedTagIds.filter((id) => id !== tag.id));
      if (clearInput) setTagInput("");
      setTagError("");
      return;
    }
    if (selectedTagIds.length >= 12) {
      setTagError("每篇文章最多添加 12 个标签");
      return;
    }
    setKnownTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag]);
    onTagIds([...selectedTagIds, tag.id]);
    if (clearInput) setTagInput("");
    setTagError("");
    requestAnimationFrame(() => tagInputRef.current?.focus());
  }

  async function toggleTagPicker() {
    const next = !tagPickerOpen;
    setTagPickerOpen(next);
    if (next) setDrawerSearch("");
    if (!next || allTagsLoadedRef.current || tagPickerLoading) return;
    setTagPickerLoading(true);
    try {
      const response = await fetch("/api/original/tags", { credentials: "same-origin" });
      const result = await response.json().catch(() => ({})) as { tags?: OriginalComposerTag[]; error?: string };
      if (!response.ok) throw new Error(result.error || "标签加载失败");
      const received = Array.isArray(result.tags) ? result.tags : [];
      setKnownTags((current) => {
        const merged = new Map(current.map((tag) => [tag.id, tag]));
        received.forEach((tag) => merged.set(tag.id, tag));
        return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
      });
      allTagsLoadedRef.current = true;
    } catch (error) {
      setTagError(error instanceof Error ? error.message : "标签加载失败");
    } finally {
      setTagPickerLoading(false);
    }
  }

  async function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tagCreating) return;
    const name = normalizeOriginalTagName(tagInput);
    if (!name) return;
    if (!isValidOriginalTagName(name)) {
      setTagError("中文标签需为 2–6 个汉字，英文标签需为 2–15 个字母且不能包含空格或符号");
      return;
    }
    const existing = knownTags.find((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      selectTag(existing);
      return;
    }
    if (selectedTagIds.length >= 12) {
      setTagError("每篇文章最多添加 12 个标签");
      return;
    }
    setTagCreating(true);
    setTagError("");
    try {
      const tag = await onCreateTag(name);
      selectTag(tag);
    } catch (error) {
      setTagError(error instanceof Error ? error.message : "标签创建失败");
    } finally {
      setTagCreating(false);
    }
  }

  const selectedTags = selectedTagIds
    .map((id) => knownTags.find((tag) => tag.id === id))
    .filter((tag): tag is OriginalComposerTag => Boolean(tag));
  const deferredDrawerSearch = useDeferredValue(drawerSearch);
  const normalizedDrawerFilter = deferredDrawerSearch.normalize("NFKC").trim().toLocaleLowerCase();
  const filteredDrawerTags = knownTags
    .filter((tag) => !normalizedDrawerFilter || tag.name.toLocaleLowerCase().includes(normalizedDrawerFilter))
    .slice(0, 100);

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.publishDialog}`} onClose={onClose}>
      <header><h2>发布设置</h2><button type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭发布设置"><X size={20} /></button></header>
      <div className={styles.publishDialogBody}>
        <section className={styles.publishAccessSection}>
          <div className={styles.publishTypePicker} role="radiogroup" aria-label="阅读方式">
            <button
              type="button"
              role="radio"
              aria-checked={!paid}
              className={`${styles.publishTypeOption}${!paid ? ` ${styles.publishTypeOptionActive}` : ""}`}
              onClick={() => onPrice(0)}
            >
              免费
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={paid}
              className={`${styles.publishTypeOption}${paid ? ` ${styles.publishTypeOptionActive}` : ""}`}
              onClick={() => onPrice(Math.max(price, 1))}
            >
              付费
            </button>
          </div>
          {paid ? (
            <div className={styles.publishPaidOptions}>
              <label className={styles.fieldLabel}><span>价格</span>
              <span className={styles.priceControl}>
                <input type="number" min={1} max={1_000_000} inputMode="numeric" value={price} onChange={(event) => onPrice(Math.max(1, Math.floor(Number(event.target.value) || 1)))} />
                <span>苏打</span>
              </span>
            </label>
            {hasPaidGate ? (
              <p className={styles.validLine}>
                <Check size={14} aria-hidden="true" />已设置付费分界
              </p>
            ) : (
              <div className={styles.paidGatePrompt}>
                <p className={styles.paidGateHint}>在正文插入付费分界，前面免费，后面需解锁。</p>
                <button type="button" className={styles.insertPaidGateButton} onClick={onInsertPaidGate}>
                  插入分界
                </button>
              </div>
            )}
            </div>
          ) : null}
        </section>
        <section className={styles.tagSection}>
          <div className={styles.sectionHeading}><h3>标签</h3><span>{selectedTags.length}/12</span></div>
          <form className={styles.tagComposer} onSubmit={(event) => void submitTag(event)}>
            <input
              value={tagInput}
              ref={tagInputRef}
              disabled={tagCreating}
              onChange={(event) => {
                setTagInput(event.target.value);
                if (tagError) setTagError("");
              }}
              maxLength={15}
              placeholder="输入标签，回车添加"
              aria-label="添加文章标签"
            />
            <button
              type="button"
              className={styles.tagPickerButton}
              aria-label="选择已有标签"
              title="选择已有标签"
              aria-expanded={tagPickerOpen}
              onClick={() => void toggleTagPicker()}
            >
              <Tags size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </form>
          {tagError ? <p className={styles.tagError} role="alert">{tagError}</p> : null}
          <div className={styles.tagSelection} aria-label="已选标签">
            {selectedTags.map((tag) => (
              <button
                type="button"
                className="tagChip contentTagLink"
                key={tag.id}
                aria-label={`取消标签 ${tag.name}`}
                title="点击取消"
                onClick={() => onTagIds(selectedTagIds.filter((id) => id !== tag.id))}
              >
                <span>{tag.name}</span>
                <X size={12} strokeWidth={2.2} aria-hidden="true" className={styles.tagRemoveIcon} />
              </button>
            ))}
          </div>
        </section>
      </div>
      <footer>
        <button type="button" onClick={() => dialogRef.current?.close()}>继续编辑</button>
        <button type="button" className={styles.primaryButton} disabled={publishing} onClick={() => void onPublish()}>
          {publishing ? "正在发布…" : "确认发布"}
        </button>
      </footer>
      {errorMessage ? <p className={styles.publishError} role="alert">{errorMessage}</p> : null}

      {tagPickerOpen ? (
        <div
          className={styles.tagDrawerBackdrop}
          onClick={() => setTagPickerOpen(false)}
        >
          <aside
            className={styles.tagPicker}
            role="dialog"
            aria-modal="true"
            aria-label="选择已有标签"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.tagPickerHeader}>
              <div className={styles.tagPickerTitleGroup}>
                <strong>选择已有标签</strong>
                <span className={styles.tagPickerCountBadge}>
                  {normalizedDrawerFilter ? `${filteredDrawerTags.length} 个匹配` : `共 ${knownTags.length} 个标签`}
                </span>
              </div>
              <button
                type="button"
                className={styles.tagPickerCloseButton}
                aria-label="关闭标签抽屉"
                onClick={() => setTagPickerOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className={styles.tagPickerSearchWrap}>
              <Search size={14} className={styles.tagPickerSearchIcon} aria-hidden="true" />
              <input
                type="text"
                className={styles.tagPickerSearchInput}
                value={drawerSearch}
                onChange={(event) => setDrawerSearch(event.target.value)}
                placeholder="搜索已有标签…"
                aria-label="搜索已有标签"
                autoFocus
              />
              {drawerSearch ? (
                <button
                  type="button"
                  className={styles.tagPickerSearchClear}
                  onClick={() => setDrawerSearch("")}
                  aria-label="清除搜索"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className={styles.tagPickerOptions} role="listbox" aria-label="已有标签">
              {filteredDrawerTags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id);
                return (
                  <button
                    className="tagChip contentTagLink"
                    type="button"
                    key={tag.id}
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectTag(tag, false)}
                  >
                    <span>{tag.name}</span>
                    {selected ? <Check size={12} strokeWidth={2.2} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            {tagPickerLoading ? <p className={styles.dialogHint}>加载中…</p> : null}
            {!tagPickerLoading && !filteredDrawerTags.length ? (
              <p className={styles.dialogHint}>未找到匹配的标签</p>
            ) : null}
            <footer className={styles.tagPickerFooter}>
              <span className={styles.tagPickerSelectedSummary}>
                已选 {selectedTagIds.length}/12 个标签
              </span>
              <button
                type="button"
                className={styles.tagPickerDoneButton}
                onClick={() => setTagPickerOpen(false)}
              >
                完成
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </dialog>
  );
}
