"use client";

import {
  Bold,
  Code2,
  Eraser,
  Heading1,
  Italic,
  Link2,
  LockKeyhole,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type TextFormatType,
} from "lexical";
import {
  $clearFormatting,
  $readSelectionState,
  $selectionIsInCode,
  $setParagraphBlocks,
  $toggleBlock,
  EMPTY_SELECTION_STATE,
  sameSelectionState,
  type OriginalTextFormat,
} from "./editor-commands";
import {
  editorSelectionBookmark,
  insertPaidGateIntoEditor,
  restoreEditorSelection,
  type SelectionBookmark,
} from "./composer-document";
import { $createDividerNode } from "./nodes/DividerNode";
import type { SourceTool } from "./source-editing";
import styles from "./OriginalComposer.module.css";

/**
 * Swallow the press that would move focus out of the manuscript. This has to be
 * `pointerdown`: on a touch screen `mousedown` is synthesised only *after* `touchend`,
 * by which time the caret and the on-screen keyboard are already gone.
 */
function keepEditorFocus(event: React.PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}

/**
 * One toolbar button: an icon over its name, the way a writing tool labels its commands.
 * A click acts at once and a second click undoes it — there is no double-click mode.
 * The press is swallowed so the editor keeps its caret and selection.
 */
function ToolbarButton({
  label,
  shortcut,
  pressed,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={shortcut ? `${label}（${shortcut}）` : label}
      className={pressed ? styles.toolActive : undefined}
      disabled={disabled}
      onPointerDown={keepEditorFocus}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/** A command in the mobile sheet. Same focus rule as the toolbar: the sheet must
 *  never be the reason a selection disappears. */
function SheetButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={pressed} onPointerDown={keepEditorFocus} onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
  );
}

const TEXT_FORMAT_BUTTONS: Array<{ format: OriginalTextFormat; label: string; shortcut?: string; Icon: typeof Bold }> = [
  { format: "bold", label: "加粗", shortcut: "Ctrl+B", Icon: Bold },
  { format: "italic", label: "斜体", shortcut: "Ctrl+I", Icon: Italic },
  { format: "underline", label: "下划线", shortcut: "Ctrl+U", Icon: Underline },
  { format: "strikethrough", label: "删除线", Icon: Strikethrough },
];

export function ComposerToolbar({
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
  const [selectionState, setSelectionState] = useState(EMPTY_SELECTION_STATE);
  const [mobilePanel, setMobilePanel] = useState<"format" | "insert" | null>(null);
  const mobileDialogRef = useRef<HTMLDialogElement>(null);
  const sheetSelectionRef = useRef<SelectionBookmark | null>(null);

  useEffect(() => {
    const dialog = mobileDialogRef.current;
    if (mobilePanel && !dialog?.open) dialog?.showModal();
    if (!mobilePanel && dialog?.open) dialog.close();
  }, [mobilePanel]);

  // Every commit — typing, undo, shortcuts, caret moves, a pending format toggled on a
  // collapsed caret — refreshes the pressed states; React re-renders only on a change.
  useEffect(() => {
    const refresh = () => editor.getEditorState().read(() => {
      const next = $readSelectionState();
      setSelectionState((current) => (sameSelectionState(current, next) ? current : next));
    });
    return mergeRegister(
      editor.registerCommand(CAN_UNDO_COMMAND, (value) => { setCanUndo(value); return false; }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(CAN_REDO_COMMAND, (value) => { setCanRedo(value); return false; }, COMMAND_PRIORITY_LOW),
      editor.registerUpdateListener(refresh),
    );
  }, [editor]);

  /** `showModal` moves focus into the sheet, which collapses the manuscript's caret.
   *  Bookmark the range on the way in so a command chosen from the sheet still acts on
   *  the text the writer had selected. */
  function openMobilePanel(panel: "format" | "insert") {
    sheetSelectionRef.current = sourceMode ? null : editorSelectionBookmark(editor);
    setMobilePanel(panel);
  }

  function applyMobileTool(action: () => void) {
    mobileDialogRef.current?.close();
    const bookmark = sheetSelectionRef.current;
    if (!sourceMode && bookmark) editor.update(() => { restoreEditorSelection(bookmark); });
    action();
    if (!sourceMode) editor.focus();
  }

  function run(tool: SourceTool, action: () => void) {
    if (sourceMode) onSourceTool(tool); else action();
  }

  function toggleTextFormat(format: OriginalTextFormat) {
    if (sourceMode) {
      onSourceTool(format, true);
      return;
    }
    const blocked = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) ? $selectionIsInCode(selection) : true;
    });
    if (!blocked) editor.dispatchCommand(FORMAT_TEXT_COMMAND, format as TextFormatType);
  }

  function toggleBlock(kind: "heading" | "quote") {
    run(kind === "heading" ? "h1" : "quote", () => editor.update(() => { $toggleBlock(kind); }));
  }

  function clearFormatting() {
    run("clear", () => editor.update(() => { $clearFormatting(); }));
  }

  function insertPaidGate() {
    run("paid", () => insertPaidGateIntoEditor(editor));
  }

  function insertDivider() {
    run("divider", () => editor.update(() => { $insertNodes([$createDividerNode(), $createParagraphNode()]); }));
  }

  const undo = () => sourceMode ? onSourceHistory(false) : editor.dispatchCommand(UNDO_COMMAND, undefined);
  const redo = () => sourceMode ? onSourceHistory(true) : editor.dispatchCommand(REDO_COMMAND, undefined);
  const { formats, block } = selectionState;

  // One flat row, in the order a novelist reaches for things. Lists, inline code and
  // lower heading levels stay *supported* as Markdown syntax — they just do not earn a
  // permanent button in a long-form writing surface.
  return (
    <>
    <div className={styles.toolbar} role="toolbar" aria-label="文章格式工具">
      <div className={styles.desktopToolbar}>
        <ToolbarButton label="撤销" shortcut="Ctrl+Z" disabled={sourceMode ? !sourceUndo : !canUndo} onClick={undo}><Undo2 size={18} /></ToolbarButton>
        <ToolbarButton label="重做" shortcut="Ctrl+Shift+Z" disabled={sourceMode ? !sourceRedo : !canRedo} onClick={redo}><Redo2 size={18} /></ToolbarButton>
        <ToolbarButton label="清除格式" onClick={clearFormatting}><Eraser size={18} /></ToolbarButton>
        <ToolbarButton label="章节" pressed={!sourceMode && block === "heading"} onClick={() => toggleBlock("heading")}><Heading1 size={18} /></ToolbarButton>
        {TEXT_FORMAT_BUTTONS.map(({ format, label, shortcut, Icon }) => (
          <ToolbarButton key={format} label={label} shortcut={shortcut} pressed={!sourceMode && formats[format]} onClick={() => toggleTextFormat(format)}>
            <Icon size={18} />
          </ToolbarButton>
        ))}
        <ToolbarButton label="引用" pressed={!sourceMode && block === "quote"} onClick={() => toggleBlock("quote")}><Quote size={18} /></ToolbarButton>
        <ToolbarButton label="链接" shortcut="Ctrl+K" onClick={onLinkRequest}><Link2 size={18} /></ToolbarButton>
        <ToolbarButton label="分割线" onClick={insertDivider}><Minus size={18} /></ToolbarButton>
        <ToolbarButton label={sourceMode ? "渲染" : "源码"} pressed={sourceMode} onClick={onSourceToggle}><Code2 size={18} /></ToolbarButton>
        <ToolbarButton label="付费分界" onClick={insertPaidGate}><LockKeyhole size={18} /></ToolbarButton>
      </div>
      <div className={styles.mobileToolbar}>
        <ToolbarButton label="文字格式" pressed={mobilePanel === "format"} onClick={() => openMobilePanel("format")}><Type size={22} /></ToolbarButton>
        <ToolbarButton label={sourceMode ? "渲染" : "插入"} pressed={sourceMode || mobilePanel === "insert"} onClick={() => sourceMode ? onSourceToggle() : openMobilePanel("insert")}>{sourceMode ? <Code2 size={22} /> : <Plus size={22} />}</ToolbarButton>
        <ToolbarButton label="撤销" disabled={sourceMode ? !sourceUndo : !canUndo} onClick={undo}><Undo2 size={22} /></ToolbarButton>
        <ToolbarButton label="重做" disabled={sourceMode ? !sourceRedo : !canRedo} onClick={redo}><Redo2 size={22} /></ToolbarButton>
      </div>
    </div>
    {/* Outside the toolbar, so the toolbar's button styles never reach the sheet. */}
    <dialog ref={mobileDialogRef} className={`${styles.dialog} ${styles.formatDialog}`} aria-label={mobilePanel === "insert" ? "插入内容" : "文字格式"} onClose={() => setMobilePanel(null)}>
        <header><strong>{mobilePanel === "insert" ? "插入内容" : "文字格式"}</strong><button type="button" onClick={() => mobileDialogRef.current?.close()} aria-label="关闭菜单"><X size={19} /></button></header>
        <div className={styles.formatGrid}>
          {mobilePanel === "format" ? <>
            {TEXT_FORMAT_BUTTONS.map(({ format, label, Icon }) => (
              <SheetButton key={format} label={label} pressed={formats[format]} onClick={() => applyMobileTool(() => toggleTextFormat(format))}><Icon size={21} /></SheetButton>
            ))}
            <SheetButton label="清除格式" onClick={() => applyMobileTool(clearFormatting)}><Eraser size={21} /></SheetButton>
          </> : <>
            <SheetButton label="章节" pressed={block === "heading"} onClick={() => applyMobileTool(() => toggleBlock("heading"))}><Heading1 size={21} /></SheetButton>
            <SheetButton label="正文" onClick={() => applyMobileTool(() => run("paragraph", () => editor.update(() => { $setParagraphBlocks(); })))}><Pilcrow size={21} /></SheetButton>
            <SheetButton label="引用" pressed={block === "quote"} onClick={() => applyMobileTool(() => toggleBlock("quote"))}><Quote size={21} /></SheetButton>
            <SheetButton label="链接" onClick={() => { mobileDialogRef.current?.close(); onLinkRequest(); }}><Link2 size={21} /></SheetButton>
            <SheetButton label="分割线" onClick={() => applyMobileTool(insertDivider)}><Minus size={21} /></SheetButton>
            <SheetButton label="付费分界" onClick={() => applyMobileTool(insertPaidGate)}><LockKeyhole size={21} /></SheetButton>
            <SheetButton label="源码" onClick={() => { mobileDialogRef.current?.close(); onSourceToggle(); }}><Code2 size={21} /></SheetButton>
          </>}
        </div>
    </dialog>
    </>
  );
}
