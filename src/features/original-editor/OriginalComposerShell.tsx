"use client";

import {
  Bold,
  Check,
  ChevronLeft,
  Code2,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  LockKeyhole,
  Minus,
  Quote,
  Redo2,
  Save,
  Settings2,
  Strikethrough,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { $setBlocksType } from "@lexical/selection";
import { CodeNode, $createCodeNode } from "@lexical/code";
import { LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { HeadingNode, QuoteNode, $createQuoteNode, $isHeadingNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isParagraphNode,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import { PAID_GATE_TOKEN } from "./serialization";
import { deleteLocalOriginalDraft, readLocalOriginalDraft, writeLocalOriginalDraft } from "./local-draft";
import { DividerNode, $createDividerNode } from "./nodes/DividerNode";
import { OriginalHeadingNode, $createOriginalHeadingNode, $isOriginalHeadingNode } from "./nodes/OriginalHeadingNode";
import { OriginalImageNode, $createOriginalImageNode } from "./nodes/OriginalImageNode";
import { PaidGateNode, $createPaidGateNode, $isPaidGateNode } from "./nodes/PaidGateNode";
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
type OutlineItem = { id: string; level: 2 | 3; text: string; paid: boolean };

const MAX_TITLE_LENGTH = 100;
const LOCAL_SAVE_DELAY_MS = 350;
const SERVER_SAVE_DELAY_MS = 900;
const MAX_SERVER_SAVE_INTERVAL_MS = 5_000;

function randomId(prefix: string): string {
  return `${prefix}_${typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function initialEditorState(draft: OriginalComposerDraft) {
  if (draft.editorStateJson) return draft.editorStateJson;
  return () => {
    const source = draft.legacyMarkdown || "";
    if (source.trim()) {
      $convertFromMarkdownString(source, TRANSFORMERS);
      for (const node of $getRoot().getChildren()) {
        if ($isParagraphNode(node) && node.getTextContent().trim() === PAID_GATE_TOKEN) {
          node.replace($createPaidGateNode());
          continue;
        }
        if ($isHeadingNode(node) && !$isOriginalHeadingNode(node)) {
          const replacement = $createOriginalHeadingNode(node.getTag() === "h3" ? "h3" : "h2");
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
        level: node.tag === "h3" ? 3 : 2,
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
  if (state === "offline") return "离线，已保存在本机";
  if (state === "error") return "保存失败，点击重试";
  if (state === "conflict") return "另一页面保存了更新版本";
  if (state === "saved" || state === "clean") {
    if (!savedAt) return "已保存";
    return `已保存 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(savedAt)}`;
  }
  return "已保存";
}

function replaceCurrentBlock(editor: LexicalEditor, kind: "paragraph" | "h2" | "h3" | "quote" | "code") {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    $setBlocksType(selection, () => {
      if (kind === "h2" || kind === "h3") return $createOriginalHeadingNode(kind);
      if (kind === "quote") return $createQuoteNode();
      if (kind === "code") return $createCodeNode();
      return $createParagraphNode();
    });
  });
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={active ? styles.toolActive : undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ComposerToolbar({ onImageUpload }: { onImageUpload: (file: File) => Promise<void> }) {
  const [editor] = useLexicalComposerContext();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [formats, setFormats] = useState({ bold: false, italic: false, underline: false, strike: false });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => mergeRegister(
    editor.registerCommand(CAN_UNDO_COMMAND, (value) => { setCanUndo(value); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_REDO_COMMAND, (value) => { setCanRedo(value); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(SELECTION_CHANGE_COMMAND, () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          setFormats({
            bold: selection.hasFormat("bold"),
            italic: selection.hasFormat("italic"),
            underline: selection.hasFormat("underline"),
            strike: selection.hasFormat("strikethrough"),
          });
        }
      });
      return false;
    }, COMMAND_PRIORITY_LOW),
  ), [editor]);

  function insertPaidGate() {
    editor.update(() => {
      if ($getRoot().getChildren().some($isPaidGateNode)) {
        document.querySelector<HTMLElement>("[data-original-paid-gate]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      $insertNodes([$createPaidGateNode(), $createParagraphNode()]);
    });
  }

  function insertDivider() {
    editor.update(() => $insertNodes([$createDividerNode(), $createParagraphNode()]));
  }

  function insertLink() {
    const url = window.prompt("输入链接地址（仅支持 http、https、mailto 或站内路径）");
    if (!url) return;
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
  }

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="文章格式工具">
      <ToolbarButton label="撤销" disabled={!canUndo} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo2 size={18} /></ToolbarButton>
      <ToolbarButton label="重做" disabled={!canRedo} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo2 size={18} /></ToolbarButton>
      <span className={styles.toolDivider} aria-hidden="true" />
      <ToolbarButton label="二级标题" onClick={() => replaceCurrentBlock(editor, "h2")}><Heading2 size={18} /></ToolbarButton>
      <ToolbarButton label="三级标题" onClick={() => replaceCurrentBlock(editor, "h3")}><Heading3 size={18} /></ToolbarButton>
      <ToolbarButton label="加粗" active={formats.bold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}><Bold size={18} /></ToolbarButton>
      <ToolbarButton label="斜体" active={formats.italic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}><Italic size={18} /></ToolbarButton>
      <ToolbarButton label="下划线" active={formats.underline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}><Underline size={18} /></ToolbarButton>
      <ToolbarButton label="删除线" active={formats.strike} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")}><Strikethrough size={18} /></ToolbarButton>
      <ToolbarButton label="无序列表" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}><List size={18} /></ToolbarButton>
      <ToolbarButton label="有序列表" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}><ListOrdered size={18} /></ToolbarButton>
      <ToolbarButton label="引用" onClick={() => replaceCurrentBlock(editor, "quote")}><Quote size={18} /></ToolbarButton>
      <ToolbarButton label="代码块" onClick={() => replaceCurrentBlock(editor, "code")}><Code2 size={18} /></ToolbarButton>
      <ToolbarButton label="分隔线" onClick={insertDivider}><Minus size={18} /></ToolbarButton>
      <ToolbarButton label="链接" onClick={insertLink}><Link2 size={18} /></ToolbarButton>
      <ToolbarButton label="图片" onClick={() => fileInput.current?.click()}><ImagePlus size={18} /></ToolbarButton>
      <ToolbarButton label="付费分界" onClick={insertPaidGate}><LockKeyhole size={18} /></ToolbarButton>
      <input
        ref={fileInput}
        className={styles.hiddenInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void onImageUpload(file);
        }}
      />
    </div>
  );
}

function StructuralSafetyPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
    const node = selection.anchor.getNode();
    const previous = node.getPreviousSibling();
    if (!$isPaidGateNode(previous)) return false;
    event?.preventDefault();
    if (window.confirm("删除付费分界会把后续内容恢复为公开内容，确定继续吗？")) {
      previous.remove();
    }
    return true;
  }, COMMAND_PRIORITY_LOW), [editor]);
  return null;
}

function ImagePastePlugin({ upload }: { upload: (file: File) => Promise<void> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files || []).find((candidate) => candidate.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void upload(file);
    };
    const onDrop = (event: DragEvent) => {
      const file = Array.from(event.dataTransfer?.files || []).find((candidate) => candidate.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void upload(file);
    };
    root.addEventListener("paste", onPaste);
    root.addEventListener("drop", onDrop);
    return () => {
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("drop", onDrop);
    };
  }, [editor, upload]);
  return null;
}

function EditorBridge({
  onState,
  onEditor,
}: {
  onState: (state: EditorState, editor: LexicalEditor) => void;
  onEditor: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onEditor(editor), [editor, onEditor]);
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

export function OriginalComposerShell({
  initialDraft,
  tags,
}: {
  initialDraft: OriginalComposerDraft;
  tags: OriginalComposerTag[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialDraft.title);
  const [tagIds, setTagIds] = useState<number[]>(initialDraft.tagIds);
  const [price, setPrice] = useState(initialDraft.unlockSodaPrice);
  const [revision, setRevision] = useState(initialDraft.revision);
  const [savedAt, setSavedAt] = useState(initialDraft.autosavedAt);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [editorJson, setEditorJson] = useState(initialDraft.editorStateJson);
  const [wordCount, setWordCount] = useState(() => textCount(initialDraft.editorStateJson));
  const [outline, setOutline] = useState<OutlineItem[]>(() => outlineFromEditorJson(initialDraft.editorStateJson));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [serverConflict, setServerConflict] = useState<OriginalComposerDraft | null>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const latestJsonRef = useRef(initialDraft.editorStateJson);
  const localTimer = useRef<number | null>(null);
  const serverTimer = useRef<number | null>(null);
  const maxTimer = useRef<number | null>(null);
  const savingPromise = useRef<Promise<boolean> | null>(null);
  const revisionRef = useRef(initialDraft.revision);
  const titleRef = useRef(title);
  const tagsRef = useRef(tagIds);
  const priceRef = useRef(price);
  const dirtyRef = useRef(false);
  const broadcast = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    titleRef.current = title;
    tagsRef.current = tagIds;
    priceRef.current = price;
  }, [price, tagIds, title]);

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
    const json = latestJsonRef.current;
    await writeLocalOriginalDraft({
      draftId: initialDraft.id,
      revision: revisionRef.current,
      title: titleRef.current,
      editorStateJson: json,
      tagIds: tagsRef.current,
      unlockSodaPrice: priceRef.current,
      savedAt: Date.now(),
    });
  }, [initialDraft.id]);

  const saveToServer = useCallback(async (force = false): Promise<boolean> => {
    if (savingPromise.current) return savingPromise.current;
    if (!dirtyRef.current && !force) return true;
    const run = (async () => {
      setSaveState("saving");
      await persistLocal();
      if (!navigator.onLine) {
        setSaveState("offline");
        return false;
      }
      try {
        const response = await fetch(`/api/original/drafts/${initialDraft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
          body: JSON.stringify({
            revision: revisionRef.current,
            title: titleRef.current,
            editorStateJson: latestJsonRef.current,
            tagIds: tagsRef.current,
            unlockSodaPrice: priceRef.current,
          }),
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
        setRevision(result.draft.revision);
        setSavedAt(result.draft.autosavedAt);
        dirtyRef.current = false;
        setSaveState("saved");
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
    return run;
  }, [initialDraft.id, persistLocal]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("dirty");
    if (localTimer.current) window.clearTimeout(localTimer.current);
    localTimer.current = window.setTimeout(() => void persistLocal(), LOCAL_SAVE_DELAY_MS);
    if (serverTimer.current) window.clearTimeout(serverTimer.current);
    serverTimer.current = window.setTimeout(() => void saveToServer(), SERVER_SAVE_DELAY_MS);
    if (!maxTimer.current) {
      maxTimer.current = window.setTimeout(() => {
        maxTimer.current = null;
        void saveToServer();
      }, MAX_SERVER_SAVE_INTERVAL_MS);
    }
  }, [persistLocal, saveToServer]);

  useEffect(() => {
    void readLocalOriginalDraft(initialDraft.id).then((local) => {
      if (!local || local.savedAt <= initialDraft.updatedAt || !local.editorStateJson) return;
      if (window.confirm("发现比服务器更新的本机恢复副本，是否恢复？")) {
        titleRef.current = local.title;
        tagsRef.current = local.tagIds;
        priceRef.current = local.unlockSodaPrice;
        latestJsonRef.current = local.editorStateJson;
        setTitle(local.title);
        setTagIds(local.tagIds);
        setPrice(local.unlockSodaPrice);
        setEditorJson(local.editorStateJson);
        editorRef.current?.setEditorState(editorRef.current.parseEditorState(local.editorStateJson));
        scheduleSave();
      }
    });
  }, [initialDraft.id, initialDraft.updatedAt, scheduleSave]);

  useEffect(() => {
    const onOnline = () => { if (dirtyRef.current) void saveToServer(); };
    const onPageHide = () => { void persistLocal(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      if (localTimer.current) window.clearTimeout(localTimer.current);
      if (serverTimer.current) window.clearTimeout(serverTimer.current);
      if (maxTimer.current) window.clearTimeout(maxTimer.current);
      void persistLocal();
    };
  }, [persistLocal, saveToServer]);

  const handleEditorState = useCallback((state: EditorState, editor: LexicalEditor) => {
    if (editor.isComposing()) return;
    const json = JSON.stringify(state.toJSON());
    latestJsonRef.current = json;
    setEditorJson(json);
    setWordCount(textCount(json));
    setOutline(outlineFromEditorJson(json));
    scheduleSave();
  }, [scheduleSave]);

  const uploadImage = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setMessage("图片不能超过 10 MB");
      return;
    }
    const formData = new FormData();
    formData.set("image", file);
    setMessage("图片上传中…");
    try {
      const response = await fetch("/api/original/assets", {
        method: "POST",
        headers: { "X-Novel-Mutation": "1" },
        body: formData,
        credentials: "same-origin",
      });
      const result = await response.json() as {
        asset?: { id: number; url: string; width: number; height: number };
        error?: string;
      };
      if (!response.ok || !result.asset) throw new Error(result.error || "图片上传失败");
      const altText = window.prompt("请填写图片替代文本（用于无障碍阅读）", file.name.replace(/\.[^.]+$/, "")) || "";
      editorRef.current?.update(() => {
        $insertNodes([$createOriginalImageNode({
          assetId: result.asset!.id,
          src: result.asset!.url,
          altText: altText.trim().slice(0, 300),
          caption: "",
          width: result.asset!.width,
          height: result.asset!.height,
        }), $createParagraphNode()]);
      });
      setMessage("图片已插入");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片上传失败");
    }
  }, []);

  async function publish() {
    setMessage("");
    setPublishing(true);
    try {
      const saved = await saveToServer(true);
      if (!saved) throw new Error("请先解决草稿保存问题");
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
      heading: { h2: styles.editorH2, h3: styles.editorH3 },
      quote: styles.editorQuote,
      list: { ul: styles.editorList, ol: styles.editorList, listitem: styles.editorListItem },
      link: styles.editorLink,
      text: {
        bold: styles.bold,
        italic: styles.italic,
        underline: styles.underline,
        strikethrough: styles.strikethrough,
        code: styles.inlineCode,
      },
      code: styles.editorCode,
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
      PaidGateNode,
      DividerNode,
      OriginalImageNode,
    ],
  }), [initialDraft]);

  const displayStatus = statusText(saveState, savedAt);
  const paidOutline = outline.filter((item) => item.paid).length;
  const hasPaidGate = (() => {
    try {
      return (JSON.parse(editorJson) as { root?: { children?: Array<{ type?: string }> } }).root?.children?.some((node) => node.type === "paid-gate") || false;
    } catch {
      return false;
    }
  })();

  return (
    <main className={styles.shell}>
      <header className={styles.topBar}>
        <button type="button" className={styles.backButton} aria-label="返回原创" onClick={() => router.push("/original/mine")}>
          <ChevronLeft size={21} /><span>写文章</span>
        </button>
        <span className={styles.mobileSaveState} aria-live="polite">{displayStatus}</span>
        <button type="button" className={styles.publishTopButton} disabled={publishing} onClick={() => setSettingsOpen(true)}>
          发布
        </button>
      </header>

      <LexicalComposer initialConfig={initialConfig}>
        <ComposerToolbar onImageUpload={uploadImage} />
        <div className={styles.workspace}>
          <article className={styles.paper}>
            <input
              className={styles.titleInput}
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="请输入标题（最多 100 个字）"
              aria-label="文章标题"
              onChange={(event) => { setTitle(event.target.value); scheduleSave(); }}
            />
            <div className={styles.editorFrame}>
              <RichTextPlugin
                contentEditable={<ContentEditable className={styles.contentEditable} aria-label="文章正文" />}
                placeholder={<div className={styles.placeholder}>请输入正文</div>}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <LinkPlugin />
              <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
              <StructuralSafetyPlugin />
              <ImagePastePlugin upload={uploadImage} />
              <EditorBridge onState={handleEditorState} onEditor={(editor) => { editorRef.current = editor; }} />
            </div>
          </article>
          {outline.length ? (
            <aside className={`${styles.outline} ${outlineOpen ? styles.outlineOpen : ""}`} aria-label="文章目录">
              <header><strong>目录</strong><button type="button" onClick={() => setOutlineOpen(false)} aria-label="关闭目录"><X size={18} /></button></header>
              <nav>
                {outline.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={item.level === 3 ? styles.outlineLevel3 : undefined}
                    onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  >
                    {item.paid ? <LockKeyhole size={13} aria-hidden="true" /> : null}{item.text}
                  </button>
                ))}
              </nav>
            </aside>
          ) : null}
        </div>

        <footer className={styles.statusBar}>
          <button type="button" onClick={() => setSettingsOpen(true)}><Settings2 size={17} />发布设置</button>
          <button type="button" className={styles.outlineButton} onClick={() => setOutlineOpen(true)}><List size={17} />目录</button>
          <span>{wordCount.toLocaleString("zh-CN")} 字</span>
          <button
            type="button"
            className={styles.saveStatusButton}
            aria-live="polite"
            onClick={() => void saveToServer(true)}
          >
            {saveState === "saving" ? <Save size={16} className={styles.spin} /> : saveState === "saved" || saveState === "clean" ? <Check size={16} /> : <Save size={16} />}
            {displayStatus}
          </button>
          <button type="button" className={styles.primaryButton} disabled={publishing} onClick={() => setSettingsOpen(true)}>发布</button>
        </footer>
      </LexicalComposer>

      {message ? <div className={styles.notice} role="status">{message}</div> : null}

      <PublishDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tags={tags}
        selectedTagIds={tagIds}
        onTagIds={(values) => { setTagIds(values); scheduleSave(); }}
        price={price}
        onPrice={(value) => { setPrice(value); scheduleSave(); }}
        hasPaidGate={hasPaidGate}
        paidHeadingCount={paidOutline}
        wordCount={wordCount}
        publishing={publishing}
        onPublish={publish}
      />

      <ConflictDialog
        open={Boolean(serverConflict)}
        onUseServer={() => {
          const draft = serverConflict;
          if (!draft) return;
          revisionRef.current = draft.revision;
          latestJsonRef.current = draft.editorStateJson;
          setRevision(draft.revision);
          setTitle(draft.title);
          setTagIds(draft.tagIds);
          setPrice(draft.unlockSodaPrice);
          if (draft.editorStateJson) editorRef.current?.setEditorState(editorRef.current.parseEditorState(draft.editorStateJson));
          dirtyRef.current = false;
          setSaveState("saved");
          setServerConflict(null);
        }}
        onKeepLocal={() => {
          const draft = serverConflict;
          if (!draft) return;
          revisionRef.current = draft.revision;
          setRevision(draft.revision);
          setServerConflict(null);
          dirtyRef.current = true;
          void saveToServer(true);
        }}
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
  price,
  onPrice,
  hasPaidGate,
  paidHeadingCount,
  wordCount,
  publishing,
  onPublish,
}: {
  open: boolean;
  onClose: () => void;
  tags: OriginalComposerTag[];
  selectedTagIds: number[];
  onTagIds: (ids: number[]) => void;
  price: number;
  onPrice: (price: number) => void;
  hasPaidGate: boolean;
  paidHeadingCount: number;
  wordCount: number;
  publishing: boolean;
  onPublish: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  const paid = price > 0;
  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.publishDialog}`} onClose={onClose}>
      <header><h2>发布设置</h2><button type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭发布设置"><X size={20} /></button></header>
      <section>
        <h3>文章类型</h3>
        <label><input type="radio" checked={!paid} onChange={() => onPrice(0)} />免费文章</label>
        <label><input type="radio" checked={paid} onChange={() => onPrice(Math.max(price, 1))} />付费文章</label>
      </section>
      {paid ? (
        <section>
          <label className={styles.fieldLabel}>解锁价格
            <input type="number" min={1} max={1_000_000} value={price} onChange={(event) => onPrice(Math.max(1, Math.floor(Number(event.target.value) || 1)))} />
          </label>
          <p className={hasPaidGate ? styles.validLine : styles.invalidLine}>
            {hasPaidGate ? `已设置付费分界 · 付费目录 ${paidHeadingCount} 节` : "请在正文中插入付费分界"}
          </p>
        </section>
      ) : null}
      <section>
        <h3>文章标签</h3>
        <div className={styles.tagGrid}>
          {tags.map((tag) => {
            const selected = selectedTagIds.includes(tag.id);
            return (
              <button
                type="button"
                key={tag.id}
                aria-pressed={selected}
                className={selected ? styles.tagSelected : undefined}
                onClick={() => onTagIds(selected
                  ? selectedTagIds.filter((id) => id !== tag.id)
                  : [...selectedTagIds, tag.id].slice(0, 12))}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      </section>
      <section className={styles.publishSummary}>
        <span>{wordCount.toLocaleString("zh-CN")} 字</span>
        <span>{paid ? `${price} 苏打解锁` : "免费阅读"}</span>
      </section>
      <footer>
        <button type="button" onClick={() => dialogRef.current?.close()}>继续编辑</button>
        <button type="button" className={styles.primaryButton} disabled={publishing || !wordCount || (paid && !hasPaidGate)} onClick={() => void onPublish()}>
          {publishing ? "正在发布…" : "确认发布"}
        </button>
      </footer>
    </dialog>
  );
}
