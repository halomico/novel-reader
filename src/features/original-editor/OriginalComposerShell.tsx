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
  Lock,
  LockKeyhole,
  LockOpen,
  Minus,
  Pilcrow,
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
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type TextFormatType,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { isValidOriginalTagName, joinOriginalBodies, normalizeOriginalTagName } from "@/lib/original-constants";
import { countOriginalMarkdownCharacters, PAID_GATE_TOKEN, serializeOriginalEditorState } from "./serialization";
import { ORIGINAL_MARKDOWN_TRANSFORMERS } from "./markdown";
import {
  $applyLockedFormats,
  $clearFormatting,
  $lockedFormatsMissing,
  $selectionIsInCode,
  EMPTY_TEXT_FORMATS,
  readSelectionFormats,
  type OriginalTextFormat,
} from "./editor-commands";
import {
  BlockEscapePlugin,
  MARKDOWN_PASTE_PATTERN,
  MarkdownPastePlugin,
  OriginalMarkdownPlugin,
  PaidGateSafetyPlugin,
} from "./plugins";
import {
  anchorFromBlocks,
  anchorFromLine,
  lineFromAnchor,
  scrollTopFromBlocks,
  TOP_ANCHOR,
  type ViewAnchor,
} from "./view-anchor";
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
type SourceHistoryEntry = { value: string; start: number; end: number };
type OutlineItem = { id: string; level: number; text: string; paid: boolean };
type SelectionBookmark = {
  anchor: { key: string; offset: number; type: "text" | "element" };
  focus: { key: string; offset: number; type: "text" | "element" };
};

const MAX_TITLE_LENGTH = 100;
const EDITOR_METADATA_DEBOUNCE_MS = 260;
const LOCAL_RECOVERY_DEBOUNCE_MS = 1_200;
const LOCAL_RECOVERY_POLL_MS = 2_000;
const ORIGINAL_TEXT_FORMAT_KEYS = Object.keys(EMPTY_TEXT_FORMATS) as OriginalTextFormat[];

/**
 * Run `task` once the browser has laid the new view out. Two animation frames is the
 * accurate signal; the timer is a fallback, because a background tab throttles frames
 * indefinitely and the reader's position must not be lost just because they switched
 * away mid-transition. Whichever arrives first wins — the task never runs twice.
 */
function afterLayout(task: () => void): () => void {
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

function sourceLineHeight(input: HTMLTextAreaElement): number {
  const parsed = Number.parseFloat(getComputedStyle(input).lineHeight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

/** How far below the sticky chrome an outline target should come to rest. */
const OUTLINE_SCROLL_MARGIN = 24;
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

/**
 * Drafts saved before the rich-text composer stored raw Markdown in plain paragraphs.
 * Convert those once on open so the writer sees a document, not source. Anything the
 * composer itself wrote is already structured and skips this entirely.
 */
function normalizeMarkdownParagraphs(editor: LexicalEditor) {
  editor.update(() => {
    for (const node of $getRoot().getChildren()) {
      if (!$isParagraphNode(node) || !node.getChildren().every($isTextNode)) continue;
      const text = node.getTextContent();
      if (!MARKDOWN_PASTE_PATTERN.test(text) && !text.includes("<!-- original-heading:")) continue;
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

/**
 * One toolbar button.
 *
 * A single click acts immediately — no timer waits to see whether a double click is
 * coming, because that made every format feel a third of a second late. The second
 * click of a double click arrives as a normal click with `detail === 2`, so the pair
 * is read directly from the event instead of being reconstructed with timers. Click
 * one toggles, click two engages the lock and forces the format on, which makes a
 * double click land on the same result whether the format started on or off.
 */
function ToolbarButton({
  label,
  hint,
  active = false,
  locked = false,
  disabled = false,
  onClick,
  onLock,
  children,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  locked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onLock?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={onLock || active ? active || locked : undefined}
      data-tooltip={hint ? `${label} · ${hint}` : label}
      data-locked={locked || undefined}
      className={`${active || locked ? styles.toolActive : ""}${locked ? ` ${styles.toolLocked}` : ""}`.trim() || undefined}
      disabled={disabled}
      // Keeping the caret and the selection is the whole point: without this the
      // editor loses focus on mousedown and the command has nothing to apply to.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (onLock && event.detail >= 2) {
          onLock();
          return;
        }
        onClick();
      }}
    >
      {children}
    </button>
  );
}

const LOCKABLE_HINT = "双击锁定，Esc 解除";

/** The inline formats that make sense to keep on while typing. Images, links, the
 *  paid boundary and "clear formatting" are one-shot commands and are excluded. */
const MOBILE_LOCKABLE_FORMATS: Array<{ format: OriginalTextFormat; label: string; Icon: typeof Bold }> = [
  { format: "bold", label: "加粗", Icon: Bold },
  { format: "italic", label: "斜体", Icon: Italic },
  { format: "underline", label: "下划线", Icon: Underline },
  { format: "strikethrough", label: "删除线", Icon: Strikethrough },
];

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
  const [formats, setFormats] = useState(EMPTY_TEXT_FORMATS);
  const [locked, setLocked] = useState<OriginalTextFormat[]>([]);
  const [mobilePanel, setMobilePanel] = useState<"format" | "insert" | null>(null);
  const mobileDialogRef = useRef<HTMLDialogElement>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

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
      const next = readSelectionFormats();
      // Re-render only on a real change; this runs after every commit.
      setFormats((current) => (
        ORIGINAL_TEXT_FORMAT_KEYS.every((key) => current[key] === next[key]) ? current : next
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

  // Re-assert locked formats after the caret moves. The read-only check first is what
  // keeps this off the typing hot path: while the lock is already satisfied — which is
  // the case for every keystroke after the first — no editor update is queued at all.
  // Queuing one per keystroke would merge the next keystrokes into a tagged update and
  // break the Markdown shortcut engine, which is how block syntax stopped rendering.
  useEffect(() => {
    if (!locked.length) return;
    const reassert = () => {
      if (!editor.getEditorState().read(() => $lockedFormatsMissing(lockedRef.current))) return;
      editor.update(() => { $applyLockedFormats(lockedRef.current); }, { tag: "format-lock" });
    };
    reassert();
    return mergeRegister(
      editor.registerCommand(SELECTION_CHANGE_COMMAND, () => { reassert(); return false; }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ENTER_COMMAND, () => { queueMicrotask(reassert); return false; }, COMMAND_PRIORITY_LOW),
    );
  }, [editor, locked]);

  // Escape releases the lock and stops the format for what comes next, without
  // touching a single character that is already written.
  useEffect(() => editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
    const held = lockedRef.current;
    if (!held.length) return false;
    setLocked([]);
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
      for (const format of held) {
        if (selection.hasFormat(format as TextFormatType)) selection.formatText(format as TextFormatType);
      }
    }, { tag: "format-lock" });
    queueMicrotask(refreshFormats);
    return true;
  }, COMMAND_PRIORITY_LOW), [editor, refreshFormats]);

  function run(tool: SourceTool, action: () => void) {
    if (sourceMode) onSourceTool(tool); else action();
  }

  /** Single click: toggle the format over the selection, or the format the next
   *  keystrokes will use when there is no selection. */
  function toggleTextFormat(format: OriginalTextFormat) {
    if (sourceMode) {
      onSourceTool(format === "code" ? "inlineCode" : format, true);
      return;
    }
    if (locked.includes(format)) setLocked((current) => current.filter((item) => item !== format));
    const blocked = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) ? $selectionIsInCode(selection) : true;
    });
    if (blocked) return;
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format as TextFormatType);
    queueMicrotask(refreshFormats);
  }

  /** Double click: keep writing in this format until it is switched off. */
  function lockTextFormat(format: OriginalTextFormat) {
    if (sourceMode) return;
    setLocked((current) => current.includes(format) ? current : [...current, format]);
    editor.update(() => { $applyLockedFormats([format]); }, { tag: "format-lock" });
    queueMicrotask(refreshFormats);
  }

  function clearFormatting() {
    setLocked([]);
    run("clear", () => {
      editor.update(() => { $clearFormatting(); });
      setFormats(EMPTY_TEXT_FORMATS);
      queueMicrotask(refreshFormats);
    });
  }

  function insertPaidGate() {
    run("paid", () => insertPaidGateIntoEditor(editor));
  }

  function insertDivider() {
    run("divider", () => editor.update(() => { $insertNodes([$createDividerNode(), $createParagraphNode()]); }));
  }

  const formatButton = (format: OriginalTextFormat, label: string, icon: React.ReactNode) => (
    <ToolbarButton
      label={label}
      hint={LOCKABLE_HINT}
      active={formats[format]}
      locked={locked.includes(format)}
      onClick={() => toggleTextFormat(format)}
      onLock={sourceMode ? undefined : () => lockTextFormat(format)}
    >
      {icon}
    </ToolbarButton>
  );

  // One flat row, in the order a novelist reaches for things. Lists, inline code and
  // heading levels below the chapter title stay *supported* as Markdown syntax — they
  // just do not earn a permanent button in a long-form writing surface.
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="文章格式工具">
      <div className={styles.desktopToolbar}>
        <ToolbarButton label="撤销" hint="Ctrl+Z" disabled={sourceMode ? !sourceUndo : !canUndo} onClick={() => sourceMode ? onSourceHistory(false) : editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo2 size={18} /></ToolbarButton>
        <ToolbarButton label="重做" hint="Ctrl+Shift+Z" disabled={sourceMode ? !sourceRedo : !canRedo} onClick={() => sourceMode ? onSourceHistory(true) : editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo2 size={18} /></ToolbarButton>
        <ToolbarButton label="清除格式" hint="选中即清除选区，未选中则清除后续输入" onClick={clearFormatting}><Eraser size={18} /></ToolbarButton>
        {formatButton("bold", "加粗", <Bold size={18} />)}
        {formatButton("italic", "斜体", <Italic size={18} />)}
        {formatButton("underline", "下划线", <Underline size={18} />)}
        {formatButton("strikethrough", "删除线", <Strikethrough size={18} />)}
        <ToolbarButton label="章节标题" hint="行首输入 # 也可以" onClick={() => run("h1", () => replaceCurrentBlock(editor, "h1"))}><Heading1 size={18} /></ToolbarButton>
        <ToolbarButton label="引用" hint="行首输入 > 也可以" onClick={() => run("quote", () => replaceCurrentBlock(editor, "quote"))}><Quote size={18} /></ToolbarButton>
        <ToolbarButton label="链接" hint="Ctrl+K" onClick={onLinkRequest}><Link2 size={18} /></ToolbarButton>
        <ToolbarButton label="分隔线" hint="场景分隔" onClick={insertDivider}><Minus size={18} /></ToolbarButton>
        <ToolbarButton label="付费分界" hint="此处之后需解锁阅读" onClick={insertPaidGate}><LockKeyhole size={18} /></ToolbarButton>
        <ToolbarButton label={sourceMode ? "退出源码" : "Markdown 源码"} hint="查看并直接编辑源码" active={sourceMode} onClick={onSourceToggle}>
          <Code2 size={18} />
        </ToolbarButton>
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
            {/* A double click is not a gesture a touch screen offers, so every lockable
                format carries its own lock toggle here instead of the lock being a
                desktop-only capability. Tapping the tile applies the format once;
                tapping the small lock keeps it on for what is typed next. */}
            {MOBILE_LOCKABLE_FORMATS.map(({ format, label, Icon }) => (
              <span className={styles.formatCell} key={format}>
                <button type="button" aria-pressed={formats[format]} onClick={() => applyMobileTool(() => toggleTextFormat(format))}><Icon size={21} /><span>{label}</span></button>
                <button
                  type="button"
                  className={styles.formatLockToggle}
                  aria-label={`${locked.includes(format) ? "解除锁定" : "锁定"}${label}`}
                  aria-pressed={locked.includes(format)}
                  onClick={() => locked.includes(format)
                    ? setLocked((current) => current.filter((item) => item !== format))
                    : lockTextFormat(format)}
                >
                  {locked.includes(format) ? <Lock size={13} /> : <LockOpen size={13} />}
                </button>
              </span>
            ))}
            <button type="button" onClick={() => applyMobileTool(clearFormatting)}><Eraser size={21} /><span>清除格式</span></button>
          </> : <>
            <button type="button" onClick={() => applyMobileTool(() => run("h1", () => replaceCurrentBlock(editor, "h1")))}><Heading1 size={21} /><span>章节标题</span></button>
            <button type="button" onClick={() => applyMobileTool(() => run("paragraph", () => replaceCurrentBlock(editor, "paragraph")))}><Pilcrow size={21} /><span>正文</span></button>
            <button type="button" onClick={() => applyMobileTool(() => run("quote", () => replaceCurrentBlock(editor, "quote")))}><Quote size={21} /><span>引用</span></button>
            <button type="button" onClick={() => { mobileDialogRef.current?.close(); onLinkRequest(); }}><Link2 size={21} /><span>链接</span></button>
            <button type="button" onClick={() => applyMobileTool(insertDivider)}><Minus size={21} /><span>分隔线</span></button>
            <button type="button" onClick={() => applyMobileTool(insertPaidGate)}><LockKeyhole size={21} /><span>付费分界</span></button>
            <button type="button" onClick={() => { mobileDialogRef.current?.close(); onSourceToggle(); }}><Code2 size={21} /><span>源码</span></button>
          </>}
        </div>
      </dialog>
    </div>
  );
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

/**
 * The composer's table of contents: a column docked to the right of the page, toggled
 * by one button, never a drawer stacked on another drawer.
 *
 * Navigation scrolls the workspace — the element that actually scrolls — and stops the
 * target below the sticky chrome instead of under it. Ids come from the heading anchors
 * the document carries, so Chinese titles, repeated titles and reordered chapters all
 * resolve correctly, and nothing here touches the document or its undo history.
 */
function ComposerOutline({
  items,
  containerRef,
  onClose,
}: {
  items: OutlineItem[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !items.length) return;
    const headings = items
      .map((item) => container.querySelector<HTMLElement>(`[id="${CSS.escape(item.id)}"]`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!headings.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible?.target.id) setActiveId(visible.target.id);
    }, { root: container, rootMargin: "0px 0px -70% 0px", threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [containerRef, items]);

  function goTo(id: string) {
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!container || !target) return;
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({
      top: Math.max(0, container.scrollTop + offset - OUTLINE_SCROLL_MARGIN),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    setActiveId(id);
  }

  return (
    <aside className={styles.outline} aria-label="文章目录">
      <header>
        <strong>目录</strong>
        <span className={styles.outlineCount}>{items.length} 节</span>
        <button type="button" onClick={onClose} aria-label="关闭目录"><X size={18} /></button>
      </header>
      {items.length ? (
        <nav>
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === activeId ? styles.outlineActive : undefined}
              aria-current={item.id === activeId ? "location" : undefined}
              style={{ paddingInlineStart: `${8 + Math.min(Math.max(item.level - 1, 0), 3) * 12}px` }}
              title={item.text}
              onClick={() => goTo(item.id)}
            >
              {item.paid ? <LockKeyhole size={13} aria-hidden="true" /> : null}
              <span>{item.text}</span>
            </button>
          ))}
        </nav>
      ) : <p className={styles.outlineEmpty}>添加标题后，这里会生成目录。</p>}
    </aside>
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
  const [previewVersion, setPreviewVersion] = useState(0);
  const preview = mode === "preview";
  const sourceMode = mode === "source";
  const [markdown, setMarkdown] = useState("");
  const [sourceWordCount, setSourceWordCount] = useState(0);
  const markdownRef = useRef("");
  const sourceElementRef = useRef<HTMLTextAreaElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sourceUndoRef = useRef<SourceHistoryEntry[]>([]);
  const sourceRedoRef = useRef<SourceHistoryEntry[]>([]);
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

  /** Word count, outline and the paid-boundary flag are refreshed lazily while typing.
   *  Anything that reads them as fact — the settings dialog, the outline panel — has to
   *  settle them first, or it can show the writer a state the document left behind. */
  const flushEditorMetadata = useCallback(() => {
    if (editorMetadataTimerRef.current !== null) {
      window.clearTimeout(editorMetadataTimerRef.current);
      editorMetadataTimerRef.current = null;
    }
    const state = latestEditorStateRef.current || editorRef.current?.getEditorState();
    if (state) applyEditorMetadata(state);
  }, [applyEditorMetadata]);

  const scheduleEditorMetadata = useCallback((state: EditorState) => {
    latestEditorStateRef.current = state;
    if (editorMetadataTimerRef.current !== null) window.clearTimeout(editorMetadataTimerRef.current);
    // One debounce, no idle callback. The walk is already off the keystroke path, and
    // deferring it again to `requestIdleCallback` meant a writer who never stopped
    // typing — or a tab the browser had throttled — kept looking at a word count and a
    // paid-boundary state that belonged to an older version of the document.
    editorMetadataTimerRef.current = window.setTimeout(() => {
      editorMetadataTimerRef.current = null;
      applyEditorMetadata(state);
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
        const input = sourceElementRef.current;
        sourceUndoRef.current = [...sourceUndoRef.current.slice(-19), {
          value: markdownRef.current,
          start: input?.selectionStart ?? markdownRef.current.length,
          end: input?.selectionEnd ?? markdownRef.current.length,
        }];
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
    afterLayout(() => {
      const input = sourceElementRef.current;
      if (!input) return;
      // Preserve the view: focusing a textarea scrolls the caret into view, which in a
      // long draft would otherwise yank the page after every toolbar command.
      const scrollTop = input.scrollTop;
      input.focus();
      input.setSelectionRange(start, end);
      input.scrollTop = scrollTop;
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
    const entry = from.pop();
    if (!entry) return;
    const input = sourceElementRef.current;
    // Each step remembers where the caret was, so undo returns the writer to the edit
    // it reversed instead of dumping them at the end of the document.
    to.push({
      value: markdownRef.current,
      start: input?.selectionStart ?? 0,
      end: input?.selectionEnd ?? 0,
    });
    updateSource(entry.value, false);
    focusSource(Math.min(entry.start, entry.value.length), Math.min(entry.end, entry.value.length));
  }

  function insertSource(text: string) {
    const input = sourceElementRef.current;
    const start = input?.selectionStart ?? markdownRef.current.length;
    const end = input?.selectionEnd ?? start;
    updateSource(markdownRef.current.slice(0, start) + text + markdownRef.current.slice(end));
    focusSource(start + text.length);
  }

  function bodyContainer(target: ComposerMode): HTMLElement | null {
    const workspace = workspaceRef.current;
    if (!workspace) return null;
    return target === "preview"
      ? workspace.querySelector<HTMLElement>(".originalBody")
      : workspace.querySelector<HTMLElement>(`.${styles.contentEditable}`);
  }

  /** Block geometry measured against the container itself, so a change of padding or
   *  of positioned ancestors cannot skew the mapping. */
  function measureBlocks(container: HTMLElement) {
    const containerTop = container.getBoundingClientRect().top;
    return Array.from(container.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return { offsetTop: rect.top - containerTop, offsetHeight: rect.height };
    });
  }

  /** The block-level position currently on screen, in whichever view is active. */
  function readViewAnchor(): ViewAnchor {
    const workspace = workspaceRef.current;
    if (mode === "source") {
      const input = sourceElementRef.current;
      if (!input) return TOP_ANCHOR;
      return anchorFromLine(markdownRef.current, Math.round(input.scrollTop / sourceLineHeight(input)));
    }
    const container = bodyContainer(mode);
    if (!container || !workspace) return TOP_ANCHOR;
    const viewportTop = workspace.getBoundingClientRect().top - container.getBoundingClientRect().top;
    return anchorFromBlocks(measureBlocks(container), viewportTop);
  }

  function applyViewAnchor(nextMode: ComposerMode, anchor: ViewAnchor) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    if (nextMode === "source") {
      const input = sourceElementRef.current;
      if (!input) return;
      input.scrollTop = lineFromAnchor(markdownRef.current, anchor) * sourceLineHeight(input);
      return;
    }
    const container = bodyContainer(nextMode);
    if (!container) return;
    const within = scrollTopFromBlocks(measureBlocks(container), anchor);
    const delta = container.getBoundingClientRect().top - workspace.getBoundingClientRect().top + within;
    workspace.scrollTop = Math.max(0, workspace.scrollTop + delta - OUTLINE_SCROLL_MARGIN);
  }

  function changeMode(nextMode: ComposerMode) {
    if (nextMode === mode) return;
    const anchor = readViewAnchor();

    // Every view is derived from one canonical document: the Lexical editor state.
    // Source edits are committed into it first, so there is never a second, subtly
    // different parse of the same draft in play.
    flushMarkdown();
    const editor = editorRef.current;
    if (editor) {
      latestEditorStateRef.current = editor.getEditorState();
      serializedEditorStateRef.current = null;
      syncEditorSnapshotToUi();
    }

    if (nextMode === "source") {
      const source = editor?.getEditorState().read(() => $convertToMarkdownString(ORIGINAL_MARKDOWN_TRANSFORMERS)) || "";
      markdownRef.current = source;
      setMarkdown(source);
      setSourceWordCount(countOriginalMarkdownCharacters(source));
      sourceUndoRef.current = [];
      sourceRedoRef.current = [];
    }

    setLinkPopoverOpen(false);
    if (nextMode === "preview") {
      flushEditorMetadata();
      setPreviewVersion((version) => version + 1);
    }
    setMode(nextMode);
    afterLayout(() => applyViewAnchor(nextMode, anchor));
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
    // Synchronizing the source view and re-asserting a locked format are
    // normalization steps, not user edits. They must not turn a clean draft
    // dirty merely because the user changed views or moved the caret.
    if (!tags.has("source-sync") && !tags.has("format-lock")) markDirty();
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

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      // Saving is a document-level action, so it works from the title and the tag
      // fields too. Inserting a link is not: it would hijack the browser's own
      // Ctrl+K anywhere else on the page, so it only fires inside the manuscript.
      if (key === "s") {
        event.preventDefault();
        void manualSave();
        return;
      }
      if (key !== "k" || event.shiftKey || event.altKey) return;
      const active = document.activeElement;
      const inManuscript = active instanceof HTMLElement
        && (active.isContentEditable || active === sourceElementRef.current);
      if (!inManuscript) return;
      event.preventDefault();
      openLinkPopover();
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [manualSave, openLinkPopover]);

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

  // The preview renders exactly what publishing would store, through the same
  // serializer and the same Markdown component the reader uses. Deriving it from a
  // second, preview-only conversion is what let preview and the published article
  // disagree about spacing, headings and the paid boundary.
  const previewDoc = useMemo(() => {
    if (!preview) return { publicMarkdown: "", paidMarkdown: "", outline: [] as OutlineItem[] };
    try {
      const document = serializeOriginalEditorState(latestJsonRef.current);
      return {
        publicMarkdown: document.publicMarkdown,
        paidMarkdown: document.paidMarkdown,
        outline: document.outline,
      };
    } catch {
      return { publicMarkdown: "", paidMarkdown: "", outline: [] as OutlineItem[] };
    }
  }, [preview, previewVersion]);
  // A paid article previews the way a reader without access sees it: public part plus
  // the unlock card. A free one shows both halves joined, exactly as the reader does.
  const previewLocked = price > 0 && hasPaidGate;
  const previewBody = previewLocked
    ? previewDoc.publicMarkdown
    : joinOriginalBodies(previewDoc.publicMarkdown, previewDoc.paidMarkdown);
  const previewOutline = previewLocked ? previewDoc.outline.filter((item) => !item.paid) : previewDoc.outline;
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
            <button
              type="button"
              className={`${styles.actionButton} ${styles.outlineButton}${outlineOpen ? ` ${styles.outlineButtonActive}` : ""}`}
              aria-label="目录"
              title="显示或隐藏目录"
              aria-expanded={outlineOpen}
              onClick={() => { flushEditorMetadata(); setOutlineOpen((open) => !open); }}
            >
              <List size={17} /><span>目录</span>
            </button>
            <button type="button" className={`${styles.actionButton} ${styles.settingsButton}`} aria-label="文章设置" title="文章设置" onClick={() => { flushEditorMetadata(); setSettingsOpen(true); }}><Settings2 size={17} /><span>设置</span></button>
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

        <div ref={workspaceRef} className={styles.workspace} data-outline={outlineOpen ? "open" : "closed"}>
          {preview ? (
            <div className={`readerShell originalReaderShell ${styles.readerPreviewSurface}`} data-reader-theme="app">
              <button type="button" className={styles.previewExitButton} aria-label="返回编辑" title="返回编辑" onClick={() => changeMode("visual")}>
                <ChevronLeft size={22} strokeWidth={1.9} aria-hidden="true" /><span>返回编辑</span>
              </button>
              <button type="button" className={styles.previewOutlineButton} aria-label="目录" title="目录" aria-expanded={outlineOpen} onClick={() => { flushEditorMetadata(); setOutlineOpen((open) => !open); }}>
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
                    <OriginalMarkdown>{previewBody}</OriginalMarkdown>
                  </div>
                </div>
              </div>
              {previewLocked ? (
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
              <OriginalMarkdownPlugin />
              <BlockEscapePlugin />
              <PaidGateSafetyPlugin onRemoveGate={removeGate} />
              <MarkdownPastePlugin />
              <EditorBridge
                onState={handleEditorState}
                onEditor={handleEditorMount}
                onReady={handleEditorReady}
              />
            </div>
          </article>
          {outlineOpen ? (
            <ComposerOutline
              items={preview ? previewOutline : outline}
              containerRef={workspaceRef}
              onClose={() => setOutlineOpen(false)}
            />
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
              <label className={styles.fieldLabel}>
                <span>价格</span>
                <span className={styles.priceControl}>
                  <input
                    type="number"
                    min={1}
                    max={1_000_000}
                    inputMode="numeric"
                    value={price}
                    onChange={(event) => onPrice(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                  />
                  <span>苏打</span>
                </span>
              </label>
              {hasPaidGate ? (
                <p className={styles.validLine}>
                  <Check size={14} aria-hidden="true" />
                  已设置付费分界
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
