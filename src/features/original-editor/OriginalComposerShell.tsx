"use client";

import { Check, ChevronLeft, CupSoda, Eye, Link2, List, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { CodeNode } from "@lexical/code";
import { LinkNode, TOGGLE_LINK_COMMAND, $createLinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  SKIP_DOM_SELECTION_TAG,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { joinOriginalBodies } from "@/lib/original-constants";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { OriginalMarkdown } from "@/components/OriginalMarkdown";
import { UserAvatar } from "@/components/UserAvatar";
import { countOriginalMarkdownCharacters, serializeOriginalEditorState } from "./serialization";
import { ORIGINAL_MARKDOWN_TRANSFORMERS } from "./markdown";
import { BlockNavigationPlugin, MarkdownPastePlugin, OriginalMarkdownPlugin } from "./plugins";
import {
  anchorFromBlocks,
  anchorFromLine,
  lineFromAnchor,
  scrollTopFromBlocks,
  TOP_ANCHOR,
  type ViewAnchor,
} from "./view-anchor";
import { DividerNode } from "./nodes/DividerNode";
import { OriginalHeadingNode } from "./nodes/OriginalHeadingNode";
import { OriginalImageNode } from "./nodes/OriginalImageNode";
import { PaidGateNode } from "./nodes/PaidGateNode";
import { editMarkdownSource, type SourceTool } from "./source-editing";
import { EditorTabPlugin } from "./EditorTabPlugin";
import { applyTextareaIndent, applyTextareaOutdent } from "./tab-indentation";
import { ComposerToolbar } from "./ComposerToolbar";
import { ComposerOutline } from "./ComposerOutline";
import { ConflictDialog, UnsavedChangesDialog } from "./ComposerDialogs";
import { PublishDialog } from "./PublishDialog";
import {
  afterLayout,
  editorHasPaidGate,
  editorMetadata,
  editorSelectionBookmark,
  initialEditorState,
  insertPaidGateIntoEditor,
  MAX_TITLE_LENGTH,
  normalizeMarkdownParagraphs,
  OUTLINE_SCROLL_MARGIN,
  outlineFromEditorJson,
  randomId,
  restoreEditorSelection,
  sameOutline,
  saveStatusText,
  sourceLineHeight,
  textCount,
  type OriginalComposerDraft,
  type OriginalComposerTag,
  type OutlineItem,
  type SaveState,
  type SelectionBookmark,
} from "./composer-document";
import styles from "./OriginalComposer.module.css";

export type { OriginalComposerDraft, OriginalComposerTag } from "./composer-document";

type ComposerMode = "visual" | "source" | "preview";
type SourceHistoryEntry = { value: string; start: number; end: number };

const EDITOR_METADATA_DEBOUNCE_MS = 260;

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

/**
 * The manuscript and its plugins. Memoised on stable callbacks, so typing in the title,
 * a save-status change or a word-count refresh never re-renders Lexical's plugin tree.
 */
const ManuscriptEditor = memo(function ManuscriptEditor({
  hidden,
  onState,
  onEditor,
  onReady,
}: {
  hidden: boolean;
  onState: (state: EditorState, editor: LexicalEditor, tags: Set<string>) => void;
  onEditor: (editor: LexicalEditor) => void;
  onReady: (state: EditorState, editor: LexicalEditor) => void;
}) {
  return (
    <div className={styles.editorFrame} hidden={hidden}>
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
      <BlockNavigationPlugin />
      <MarkdownPastePlugin />
      <EditorBridge onState={onState} onEditor={onEditor} onReady={onReady} />
    </div>
  );
});

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
  const [exiting, setExiting] = useState(false);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  // A new draft that was empty when opened and never saved since is removed, not kept
  // as an empty entry in 草稿, when the writer leaves without saving.
  const [openedEmpty] = useState(() => initialDraft.articleId === null && !initialDraft.title.trim()
    && textCount(initialDraft.editorStateJson) === 0 && !initialDraft.legacyMarkdown.trim()
    && initialDraft.tagIds.length === 0 && initialDraft.unlockSodaPrice === 0);
  const [savedOnce, setSavedOnce] = useState(false);
  // The preview simulates the published page, including unlocking the paid part — for free.
  const [previewUnlocked, setPreviewUnlocked] = useState(false);
  // Keep the three editor views mutually exclusive. Two independent booleans
  // allowed preview and source state to drift out of sync during fast toggles.
  const [mode, setMode] = useState<ComposerMode>("visual");
  const [previewVersion, setPreviewVersion] = useState(0);
  const preview = mode === "preview";
  const sourceMode = mode === "source";
  const [markdown, setMarkdown] = useState("");
  const [sourceWordCount, setSourceWordCount] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [serverConflict, setServerConflict] = useState<OriginalComposerDraft | null>(null);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const markdownRef = useRef("");
  const sourceElementRef = useRef<HTMLTextAreaElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sourceUndoRef = useRef<SourceHistoryEntry[]>([]);
  const sourceRedoRef = useRef<SourceHistoryEntry[]>([]);
  const sourceHistoryAtRef = useRef(0);
  const sourceWordCountTimerRef = useRef<number | null>(null);
  const sourceDirtyRef = useRef(false);
  const editorRef = useRef<LexicalEditor | null>(null);
  const latestEditorStateRef = useRef<EditorState | null>(null);
  const serializedEditorStateRef = useRef<EditorState | null>(null);
  const editorMetadataTimerRef = useRef<number | null>(null);
  const titleElementRef = useRef<HTMLTextAreaElement | null>(null);
  const latestJsonRef = useRef(initialDraft.editorStateJson);
  const savingPromise = useRef<Promise<boolean> | null>(null);
  const saveErrorRef = useRef("");
  const conflictRef = useRef(false);
  const revisionRef = useRef(initialDraft.revision);
  const titleRef = useRef(title);
  const tagsRef = useRef(tagIds);
  const priceRef = useRef(price);
  const dirtyRef = useRef(false);
  const savedOnceRef = useRef(false);
  const editVersionRef = useRef(0);
  const broadcast = useRef<BroadcastChannel | null>(null);
  const insertionSelectionRef = useRef<SelectionBookmark | null>(null);
  const exitHref = initialDraft.articleId === null ? "/original/mine?view=drafts" : "/original/mine";

  useEffect(() => {
    if (!message || message.endsWith("中…")) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);

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

  const applyEditorMetadata = useCallback((state: EditorState) => {
    const metadata = editorMetadata(state);
    setWordCount(metadata.wordCount);
    setOutline((current) => (sameOutline(current, metadata.outline) ? current : metadata.outline));
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
    // One debounce, no idle callback: a writer who never stops typing — or a throttled
    // tab — must not keep looking at numbers that belong to an older document.
    editorMetadataTimerRef.current = window.setTimeout(() => {
      editorMetadataTimerRef.current = null;
      applyEditorMetadata(state);
    }, EDITOR_METADATA_DEBOUNCE_MS);
  }, [applyEditorMetadata]);

  useEffect(() => () => {
    if (editorMetadataTimerRef.current !== null) window.clearTimeout(editorMetadataTimerRef.current);
    if (sourceWordCountTimerRef.current !== null) window.clearTimeout(sourceWordCountTimerRef.current);
  }, []);

  /** Send one snapshot of the draft. Concurrent callers share the request in flight. */
  const saveOnce = useCallback((): Promise<boolean> => {
    if (savingPromise.current) return savingPromise.current;
    const run = (async () => {
      setSaveState("saving");
      try {
        flushMarkdown();
        const editorStateJson = captureLatestEditorSnapshot();
        const savingVersion = editVersionRef.current;
        if (!navigator.onLine) throw new Error("网络不可用，请联网后再保存");
        const response = await fetch(`/api/original/drafts/${initialDraft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
          body: JSON.stringify({
            revision: revisionRef.current,
            title: titleRef.current,
            editorStateJson,
            tagIds: tagsRef.current,
            unlockSodaPrice: priceRef.current,
          }),
          credentials: "same-origin",
        });
        const result = await response.json().catch(() => ({})) as { draft?: OriginalComposerDraft; error?: string };
        if (response.status === 409 && result.draft) {
          conflictRef.current = true;
          setServerConflict(result.draft);
          setSaveState("conflict");
          return false;
        }
        if (!response.ok || !result.draft) throw new Error(result.error || "保存失败");
        revisionRef.current = result.draft.revision;
        saveErrorRef.current = "";
        setSavedAt(result.draft.autosavedAt);
        dirtyRef.current = editVersionRef.current !== savingVersion;
        setSaveState(dirtyRef.current ? "dirty" : "saved");
        broadcast.current?.postMessage({ revision: result.draft.revision });
        return true;
      } catch (error) {
        saveErrorRef.current = error instanceof Error ? error.message : "保存失败";
        setSaveState("error");
        return false;
      } finally {
        savingPromise.current = null;
      }
    })();
    savingPromise.current = run;
    return run;
  }, [initialDraft.id, flushMarkdown, captureLatestEditorSnapshot]);

  /** Save until the server holds exactly what is on screen. There is no background
   *  saving: this runs only for the save button, Ctrl+S, publish and a saving exit. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    for (;;) {
      if (savingPromise.current) {
        await savingPromise.current;
        continue;
      }
      if (conflictRef.current) return false;
      if (!dirtyRef.current) return true;
      if (!(await saveOnce())) return false;
    }
  }, [saveOnce]);

  const markDirty = useCallback(() => {
    editVersionRef.current += 1;
    dirtyRef.current = true;
    setSaveState((current) => current === "conflict" ? current : "dirty");
  }, []);

  const rememberSaved = useCallback(() => {
    savedOnceRef.current = true;
    setSavedOnce(true);
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
      // Focusing a textarea scrolls the caret into view, which in a long draft would
      // yank the page after every toolbar command; keep the view where it was.
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
      captureLatestEditorSnapshot();
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
      setPreviewUnlocked(false);
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
        conflictRef.current = true;
        setSaveState("conflict");
      }
    };
    return () => channel.close();
  }, [initialDraft.id]);

  const manualSave = useCallback(async () => {
    if (await saveNow()) {
      rememberSaved();
      return;
    }
    if (conflictRef.current) return;
    setMessage(saveErrorRef.current || "保存失败，请检查网络后重试");
  }, [rememberSaved, saveNow]);

  // Unsaved work is guarded by `beforeunload` (tab close / reload) and by the prompt on
  // the back button — never by trapping browser history, which consumed two entries
  // per Back press. Armed only while there is something to lose.
  const hasUnsavedWork = saveState === "dirty" || saveState === "saving" || saveState === "error" || saveState === "conflict";
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

  const handleEditorState = useCallback((state: EditorState, editor: LexicalEditor, tags: Set<string>) => {
    latestEditorStateRef.current = state;
    if (editor.isComposing()) return;
    scheduleEditorMetadata(state);
    // Synchronizing the source view is a normalization step, not a user edit. It must
    // not turn a clean draft dirty merely because the writer switched views.
    if (!tags.has("source-sync")) markDirty();
  }, [markDirty, scheduleEditorMetadata]);

  const handleEditorReady = useCallback((_state: EditorState, editor: LexicalEditor) => {
    normalizeMarkdownParagraphs(editor);
    const normalizedState = editor.getEditorState();
    latestEditorStateRef.current = normalizedState;
    serializedEditorStateRef.current = null;
    applyEditorMetadata(normalizedState);
    captureLatestEditorSnapshot();
    if (!initialDraft.editorStateJson && initialDraft.legacyMarkdown.trim()) markDirty();
  }, [applyEditorMetadata, captureLatestEditorSnapshot, initialDraft.editorStateJson, initialDraft.legacyMarkdown, markDirty]);

  const handleEditorMount = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
  }, []);

  /** A new draft the writer never put a word into is not worth keeping in 草稿. */
  const isUntouchedNewDraft = useCallback((): boolean => {
    if (initialDraft.articleId !== null || titleRef.current.trim()) return false;
    flushMarkdown();
    const editor = editorRef.current;
    if (!editor) return false;
    return editor.getEditorState().read(() => $getRoot().getChildren()
      .every((node) => $isParagraphNode(node) && !node.getTextContent().trim()));
  }, [flushMarkdown, initialDraft.articleId]);

  const deleteDraft = useCallback(async () => {
    await savingPromise.current;
    const response = await fetch(`/api/original/drafts/${initialDraft.id}`, {
      method: "DELETE",
      headers: { "X-Novel-Mutation": "1" },
      credentials: "same-origin",
    });
    if (!response.ok && response.status !== 404) throw new Error("草稿删除失败，请稍后重试");
  }, [initialDraft.id]);

  const requestExit = useCallback(async () => {
    if (publishing || exiting) return;
    if (isUntouchedNewDraft()) {
      setExiting(true);
      try {
        await deleteDraft().catch(() => undefined);
        router.replace(exitHref);
      } finally {
        setExiting(false);
      }
      return;
    }
    await savingPromise.current;
    if (dirtyRef.current || conflictRef.current) {
      setExitPromptOpen(true);
      return;
    }
    router.replace(exitHref);
  }, [deleteDraft, exitHref, exiting, isUntouchedNewDraft, publishing, router]);

  const discardAndExit = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    try {
      if (openedEmpty && !savedOnceRef.current) await deleteDraft();
      dirtyRef.current = false;
      setExitPromptOpen(false);
      router.replace(openedEmpty && !savedOnceRef.current ? "/original/mine" : exitHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "草稿删除失败，请稍后重试");
    } finally {
      setExiting(false);
    }
  }, [deleteDraft, exitHref, exiting, openedEmpty, router]);

  const saveAndExit = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    try {
      if (!(await saveNow())) throw new Error(saveErrorRef.current || "保存失败，请检查网络后重试");
      rememberSaved();
      setExitPromptOpen(false);
      router.replace(exitHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请检查网络后重试");
    } finally {
      setExiting(false);
    }
  }, [exitHref, exiting, rememberSaved, router, saveNow]);

  const openLinkPopover = useCallback(() => {
    if (sourceMode) {
      const input = sourceElementRef.current;
      setLinkText(markdownRef.current.slice(input?.selectionStart ?? 0, input?.selectionEnd ?? 0));
    } else {
      insertionSelectionRef.current = editorSelectionBookmark(editorRef.current);
      editorRef.current?.getEditorState().read(() => {
        const selection = $getSelection();
        setLinkText($isRangeSelection(selection) ? selection.getTextContent() : "");
      });
    }
    setLinkUrl("");
    setLinkPopoverOpen((open) => !open);
  }, [sourceMode]);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      // Saving is a document-level action, so it works from the title and the tag
      // fields too. Inserting a link would hijack the browser's own Ctrl+K anywhere
      // else on the page, so it only fires inside the manuscript.
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

  function confirmInlineLink(text: string, url: string) {
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
        if (!$isRangeSelection(selection)) return;
        if (selection.isCollapsed() || text.trim() !== selection.getTextContent()) {
          const linkNode = $createLinkNode(trimmedUrl);
          linkNode.append($createTextNode(label));
          selection.insertNodes([linkNode]);
        } else {
          editorRef.current?.dispatchCommand(TOGGLE_LINK_COMMAND, trimmedUrl);
        }
      });
      editorRef.current?.focus();
    }
    insertionSelectionRef.current = null;
    setLinkPopoverOpen(false);
  }

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

  const handleTagIds = useCallback((values: number[]) => {
    tagsRef.current = values;
    setTagIds(values);
    markDirty();
  }, [markDirty]);

  const handlePrice = useCallback((value: number) => {
    if (value === priceRef.current) return;
    priceRef.current = value;
    setPrice(value);
    markDirty();
  }, [markDirty]);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeOutline = useCallback(() => setOutlineOpen(false), []);
  const toggleOutline = useCallback(() => {
    flushEditorMetadata();
    setOutlineOpen((open) => !open);
  }, [flushEditorMetadata]);
  const openSettings = useCallback(() => {
    flushEditorMetadata();
    setSettingsOpen(true);
  }, [flushEditorMetadata]);

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
      if (Array.from(cleanTitle).length > MAX_TITLE_LENGTH) throw new Error("标题最多 100 个字，请缩短后再发布");
      const document = serializeOriginalEditorState(latestJsonRef.current);
      if (document.publicWordCount < 1) throw new Error("请填写正文；付费文章的公开部分至少需要 1 个字");
      if (document.paidGateCount > 0 && priceRef.current === 0) handlePrice(1);
      if (priceRef.current > 0 && document.paidGateCount !== 1) throw new Error("付费文章需要一个付费分界，请点击工具栏的“付费分界”插入");
      if (priceRef.current > 0 && document.paidWordCount < 1) throw new Error("付费分界后还没有正文，请先填写付费内容");
      if (!(await saveNow())) throw new Error(saveErrorRef.current || "请先解决草稿保存问题");
      const mutationId = randomId("publish");
      const response = await fetch(`/api/original/drafts/${initialDraft.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ revision: revisionRef.current, mutationId }),
        credentials: "same-origin",
      });
      const result = await response.json() as { slug?: string; error?: string };
      if (!response.ok || !result.slug) throw new Error(result.error || "发布失败");
      try {
        for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
          const key = sessionStorage.key(index);
          if (key?.startsWith("novel-reader:original-draft-launch:")) sessionStorage.removeItem(key);
        }
      } catch {
        // Session storage may be blocked; a published draft remains editable by its direct URL.
      }
      router.replace(`/original/${encodeURIComponent(result.slug)}`);
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
      setMessage("编辑器发生错误，请刷新页面；已保存的草稿不会丢失");
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
        underlineStrikethrough: styles.underlineStrikethrough,
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

  const selectedTags = useMemo(() => tagIds
    .map((id) => availableTags.find((tag) => tag.id === id))
    .filter((tag): tag is OriginalComposerTag => Boolean(tag)), [tagIds, availableTags]);

  // The preview renders exactly what publishing would store, through the same
  // serializer and the same Markdown component the reader uses.
  const previewDoc = useMemo(() => {
    if (!preview) return { publicMarkdown: "", paidMarkdown: "", outline: [] as OutlineItem[] };
    try {
      const document = serializeOriginalEditorState(latestJsonRef.current);
      return { publicMarkdown: document.publicMarkdown, paidMarkdown: document.paidMarkdown, outline: document.outline };
    } catch {
      return { publicMarkdown: "", paidMarkdown: "", outline: [] as OutlineItem[] };
    }
    // previewVersion is the explicit signal that the snapshot behind the ref changed.
  }, [preview, previewVersion]);
  // A paid article previews the way a reader without access sees it: public part plus
  // the unlock card. A free one shows both halves joined, exactly as the reader does.
  const previewLocked = price > 0 && hasPaidGate && !previewUnlocked;
  const previewBody = previewLocked
    ? previewDoc.publicMarkdown
    : joinOriginalBodies(previewDoc.publicMarkdown, previewDoc.paidMarkdown);
  const previewOutline = previewLocked ? previewDoc.outline.filter((item) => !item.paid) : previewDoc.outline;
  const displayedWordCount = sourceDirtyRef.current ? sourceWordCount : wordCount;
  return (
    <main className={styles.shell} data-preview={preview} data-source={sourceMode}>
      <LexicalComposer initialConfig={initialConfig}>
        {!preview ? <header className={styles.topBar}>
          <button type="button" className={styles.backButton} aria-label="返回我的原创" title="返回我的原创" disabled={publishing || exiting} onClick={() => void requestExit()}>
            <ChevronLeft size={22} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <span className={styles.workspaceTitle} aria-live="polite">{sourceMode ? "Markdown 源码" : "写文章"}</span>
          <div className={styles.topBarActions}>
            <button type="button" className={`${styles.ghostButton} ${styles.previewButton}`} aria-label="预览" title="预览" disabled={publishing} onClick={() => changeMode("preview")}>
              <Eye size={15} aria-hidden="true" />
              <span>预览</span>
            </button>
            <button
              type="button"
              className={`${styles.ghostButton} ${styles.outlineButton}${outlineOpen ? ` ${styles.outlineButtonActive}` : ""}`}
              aria-label="目录"
              title="显示或隐藏目录"
              aria-expanded={outlineOpen}
              onClick={toggleOutline}
            >
              <List size={15} /><span>目录</span>
            </button>
            <button type="button" className={`${styles.ghostButton} ${styles.settingsButton}`} aria-label="文章设置" title="文章设置" onClick={openSettings}><Settings2 size={15} /><span>设置</span></button>
            <button type="button" className={`${styles.publishButton} ${styles.topPublishButton}`} disabled={publishing} onClick={openSettings}>
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
              onChange={(event) => setLinkText(event.target.value)}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmInlineLink(linkText, linkUrl);
                } else if (event.key === "Escape") {
                  setLinkPopoverOpen(false);
                }
              }}
            />
            <input
              type="url"
              className={styles.inlineLinkUrlInput}
              placeholder="https:// 或站内路径"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmInlineLink(linkText, linkUrl);
                } else if (event.key === "Escape") {
                  setLinkPopoverOpen(false);
                }
              }}
            />
            <button type="button" className={styles.inlineLinkSubmit} onClick={() => confirmInlineLink(linkText, linkUrl)} aria-label="确认插入链接" title="确认">
              <Check size={14} />
            </button>
            <button type="button" className={styles.inlineLinkClose} onClick={() => setLinkPopoverOpen(false)} aria-label="取消" title="取消">
              <X size={14} />
            </button>
          </div>
        ) : null}

        <div className={styles.workspaceFrame}>
          <div ref={workspaceRef} className={styles.workspace}>
            {preview ? (
              <div className="readerShell originalReaderShell" data-reader-theme="app">
                <button type="button" className={`${styles.backButton} ${styles.previewExitButton}`} aria-label="返回编辑" title="返回编辑" onClick={() => changeMode("visual")}>
                  <ChevronLeft size={22} strokeWidth={1.9} aria-hidden="true" />
                </button>
                <button type="button" className={`${styles.ghostButton} ${styles.previewOutlineButton}${outlineOpen ? ` ${styles.outlineButtonActive}` : ""}`} aria-label="目录" title="显示或隐藏目录" aria-expanded={outlineOpen} onClick={toggleOutline}>
                  <List size={15} aria-hidden="true" /><span>目录</span>
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
                    <section className="novelAccessGate originalGate" aria-live="polite">
                      <div className="novelAccessGateAction">
                        <strong>解锁完整内容</strong>
                        <button
                          type="button"
                          className="novelAccessGateButton"
                          title="预览解锁，不消耗苏打"
                          onClick={() => setPreviewUnlocked(true)}
                        >
                          <CupSoda size={17} aria-hidden="true" />
                          {price} 苏打
                        </button>
                      </div>
                    </section>
                  ) : null}
                </article>
              </div>
            ) : null}

            <article className={styles.paper} hidden={preview}>
              <div className={styles.titleField}>
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
              </div>
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
              <ManuscriptEditor
                hidden={sourceMode}
                onState={handleEditorState}
                onEditor={handleEditorMount}
                onReady={handleEditorReady}
              />
            </article>
          </div>
          {outlineOpen ? (
            <ComposerOutline
              items={preview ? previewOutline : outline}
              containerRef={workspaceRef}
              onClose={closeOutline}
            />
          ) : null}
        </div>

        {!preview ? <footer className={styles.statusBar}>
          <div className={styles.statusMeta}>
            <button
              type="button"
              className={styles.saveStatus}
              data-state={saveState}
              title="点击保存（Ctrl / ⌘ + S）"
              disabled={publishing || saveState === "saving"}
              onClick={() => void manualSave()}
            >
              {saveState === "saved" || saveState === "clean" ? <Check size={14} aria-hidden="true" /> : null}
              <span role="status">{saveStatusText(saveState, savedAt)}</span>
            </button>
          </div>
          <div className={styles.statusActions}>
            <span className={styles.wordCount}>{displayedWordCount.toLocaleString("zh-CN")} 字</span>
            <button type="button" className={`${styles.publishButton} ${styles.bottomPublishButton}`} disabled={publishing} onClick={openSettings}>
              发布
            </button>
          </div>
        </footer> : null}
      </LexicalComposer>

      {message && !settingsOpen ? (
        <DismissibleNotice message={message} tone="error" variant="search" displaySeconds={5} />
      ) : null}

      <PublishDialog
        open={settingsOpen}
        onClose={closeSettings}
        tags={availableTags}
        onCreateTag={createTag}
        selectedTagIds={tagIds}
        onTagIds={handleTagIds}
        price={price}
        onPrice={handlePrice}
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

      <UnsavedChangesDialog
        open={exitPromptOpen}
        pending={exiting}
        newDraft={openedEmpty && !savedOnce}
        onCancel={() => setExitPromptOpen(false)}
        onDiscard={() => void discardAndExit()}
        onSave={() => void saveAndExit()}
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
          conflictRef.current = false;
          setSavedAt(draft.autosavedAt);
          setSaveState("saved");
          setServerConflict(null);
        }}
        onKeepLocal={() => {
          const draft = serverConflict;
          if (!draft) return;
          revisionRef.current = draft.revision;
          conflictRef.current = false;
          setServerConflict(null);
          dirtyRef.current = true;
          void manualSave();
        }}
      />
    </main>
  );
}
