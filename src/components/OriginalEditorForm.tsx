"use client";

import {
  BadgeDollarSign,
  Bold,
  Columns2,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link2,
  Maximize2,
  Minimize2,
  Minus,
  PenLine,
  Quote,
  Strikethrough,
  Underline,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "@/components/LocalizedLink";
import type { AppLocale } from "@/lib/locale";
import { uiText } from "@/lib/locale";
import {
  composeOriginalEditorBody,
  countOriginalWords,
  insertOriginalEditorBlock,
  isValidOriginalTagName,
  joinOriginalBodies,
  MAX_ORIGINAL_BODY_LENGTH,
  normalizeOriginalTagName,
  ORIGINAL_PAID_MARKER,
} from "@/lib/original-constants";
import { extractOriginalOutline } from "@/lib/original-outline";
import type { OriginalArticle, OriginalTag } from "@/lib/original";
import { OriginalMarkdown } from "./OriginalMarkdown";

type OriginalEditorAction = (formData: FormData) => void | Promise<void>;
type EditorView = "write" | "preview" | "split";

type OriginalEditorSettings = {
  maxArticlePrice: number;
  publishFeeSoda: number;
  editFeeSoda: number;
  articleMinWords: number;
  maxTags: number;
  publishNoticeText: string;
  publishNoticeLinkLabel: string;
  publishNoticeUrl: string;
};

type MarkAction = {
  label: string;
  icon: typeof Bold;
  prefix: string;
  suffix?: string;
  placeholder?: string;
  line?: boolean;
};

const MARK_ACTIONS: MarkAction[] = [
  { label: "章节标题", icon: Heading1, prefix: "# ", placeholder: "第一章", line: true },
  { label: "小节标题", icon: Heading2, prefix: "## ", placeholder: "小节标题", line: true },
  { label: "加粗", icon: Bold, prefix: "**", suffix: "**", placeholder: "文字" },
  { label: "斜体", icon: Italic, prefix: "*", suffix: "*", placeholder: "文字" },
  { label: "删除线", icon: Strikethrough, prefix: "~~", suffix: "~~", placeholder: "文字" },
  { label: "下划线", icon: Underline, prefix: "==", suffix: "==", placeholder: "文字" },
  { label: "引用", icon: Quote, prefix: "> ", placeholder: "引用内容", line: true },
  { label: "插入链接", icon: Link2, prefix: "[", suffix: "](https://example.com)", placeholder: "链接文字" },
];

function selectedLineEdit(value: string, start: number, end: number, prefix: string, placeholder = "章节") {
  const lineStart = value.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const hasContent = lines.some(Boolean);
  const removePrefix = hasContent && lines.every((line) => !line || line.startsWith(prefix));
  const replacement = lines.map((line) => {
    if (!line) return start === end ? `${prefix}${placeholder}` : line;
    return removePrefix ? line.slice(prefix.length) : `${prefix}${line}`;
  }).join("\n");
  return { start: lineStart, end: lineEnd, replacement };
}

function previewSections(body: string, paid: boolean): { publicBody: string; paidBody: string } {
  if (!paid) {
    return { publicBody: removePreviewMarkers(body), paidBody: "" };
  }
  const markerIndex = body.indexOf(ORIGINAL_PAID_MARKER);
  if (markerIndex < 0) return { publicBody: body, paidBody: "" };
  const before = body.slice(0, markerIndex);
  const after = body.slice(markerIndex + ORIGINAL_PAID_MARKER.length);
  return { publicBody: before, paidBody: after };
}

function removePreviewMarkers(body: string): string {
  return body.split(ORIGINAL_PAID_MARKER).join("");
}

export function OriginalEditorForm({
  locale,
  action,
  settings,
  article,
  mode,
  heading,
  closeHref,
  hiddenFields = {},
  availableTags = [],
}: {
  locale: AppLocale;
  action: OriginalEditorAction;
  settings: OriginalEditorSettings;
  article?: OriginalArticle;
  mode: "create" | "edit" | "admin";
  heading?: string;
  closeHref?: string;
  hiddenFields?: { articleId?: number; slug?: string };
  availableTags?: OriginalTag[];
}) {
  const tr = (text: string) => uiText(locale, text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(article?.title || "");
  const [body, setBody] = useState(composeOriginalEditorBody(article?.bodyMarkdown || "", article?.paidBodyMarkdown || ""));
  const [tags, setTags] = useState(article?.tags.map((tag) => tag.name) || []);
  const [tagDraft, setTagDraft] = useState("");
  const [tagFocused, setTagFocused] = useState(false);
  const [tagError, setTagError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [price, setPrice] = useState(article ? String(article.unlockSodaPrice) : "1");
  const [view, setView] = useState<EditorView>("write");
  const [markdownEnabled, setMarkdownEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const priceValue = Math.min(Math.max(Math.floor(Number(price) || 0), 0), settings.maxArticlePrice);
  const sections = previewSections(body, priceValue > 0);
  const markerCount = body.split(ORIGINAL_PAID_MARKER).length - 1;
  const paidReady = priceValue === 0 || (markerCount === 1 && Boolean(sections.publicBody) && Boolean(sections.paidBody));
  const visibleWordCount = countOriginalWords(removePreviewMarkers(body));
  const articleReady = mode === "admin" || visibleWordCount >= settings.articleMinWords;
  const fee = mode === "admin" ? 0 : mode === "create" ? settings.publishFeeSoda : settings.editFeeSoda;
  const feeHint = mode === "admin"
    ? tr("管理员保存不扣费")
    : `${tr(mode === "create" ? "发布将扣除" : "编辑将扣除")} ${fee} ${tr("苏打")}`;
  const tagSuggestions = availableTags
    .filter((tag) => !tags.some((selected) => selected.toLocaleLowerCase() === tag.name.toLocaleLowerCase()))
    .filter((tag) => !tagDraft.trim() || tag.name.toLocaleLowerCase().includes(tagDraft.trim().toLocaleLowerCase()))
    .slice(0, 8);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeFullscreen(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    document.addEventListener("keydown", closeFullscreen);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeFullscreen);
    };
  }, [fullscreen]);

  function commitTag(value = tagDraft) {
    const next = normalizeOriginalTagName(value);
    if (!next) {
      setTagDraft("");
      return;
    }
    if (tags.some((tag) => tag.toLocaleLowerCase() === next.toLocaleLowerCase())) {
      setTagError("");
      setTagDraft("");
      return;
    }
    if (tags.length >= settings.maxTags) {
      setTagError(tr(`每篇最多添加 ${settings.maxTags} 个标签`));
      return;
    }
    if (!isValidOriginalTagName(next)) {
      setTagError(tr("中文标签限 2–6 个汉字；英文标签限 2–15 个字母"));
      return;
    }
    setTags((current) => [...current, next]);
    setTagError("");
    setTagDraft("");
  }

  function updateBody(replacement: string, start: number, end: number) {
    const textarea = textareaRef.current;
    setBody((current) => `${current.slice(0, start)}${replacement}${current.slice(end)}`);
    requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = start + replacement.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  function applyMark(mark: MarkAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (mark.line) {
      const edit = selectedLineEdit(body, start, end, mark.prefix, mark.placeholder);
      updateBody(edit.replacement, edit.start, edit.end);
      return;
    }
    const selected = body.slice(start, end) || mark.placeholder || "文字";
    updateBody(`${mark.prefix}${selected}${mark.suffix || ""}`, start, end);
  }

  function insertDivider() {
    const textarea = textareaRef.current;
    if (textarea) {
      const result = insertOriginalEditorBlock(body, textarea.selectionStart, textarea.selectionEnd, "---");
      setBody(result.value);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(result.cursor, result.cursor);
      });
    }
  }

  function insertPaidDivider() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (priceValue <= 0) {
      setEditorError(tr("请先设置大于 0 的售价，再插入付费分界"));
      return;
    }
    if (markerCount > 0) {
      setEditorError(tr("正文中已经存在付费分界"));
      return;
    }
    const result = insertOriginalEditorBlock(body, textarea.selectionStart, textarea.selectionEnd, ORIGINAL_PAID_MARKER);
    setBody(result.value);
    setEditorError("");
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.cursor, result.cursor);
    });
  }

  function handleEditorShortcut(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLocaleLowerCase();
    const mark = key === "b"
      ? MARK_ACTIONS.find((item) => item.label === "加粗")
      : key === "i"
        ? MARK_ACTIONS.find((item) => item.label === "斜体")
        : null;
    if (!mark) return;
    event.preventDefault();
    applyMark(mark);
  }

  function Preview() {
    const outline = extractOriginalOutline(joinOriginalBodies(sections.publicBody, sections.paidBody), 30);
    return (
      <div className="originalComposerPreview">
        <div className="originalComposerPreviewBody">
          <OriginalMarkdown>{sections.publicBody || tr("暂无内容")}</OriginalMarkdown>
          {priceValue > 0 ? (
            <>
              <div className="originalPaidPreviewDivider"><span><BadgeDollarSign size={15} aria-hidden="true" />{tr("以下内容需解锁")}</span></div>
              {sections.paidBody ? <OriginalMarkdown>{sections.paidBody}</OriginalMarkdown> : null}
            </>
          ) : null}
        </div>
        {outline.length ? (
          <nav className="originalComposerOutline" aria-label={tr("目录")}>
            <strong>{tr("目录")}</strong>
            <ol>{outline.map((item, index) => <li style={{ paddingInlineStart: `${Math.max(item.level - 1, 0) * 10}px` }} key={`${item.level}-${item.text}-${index}`}>{item.text}</li>)}</ol>
          </nav>
        ) : null}
      </div>
    );
  }

  return (
    <form className={`originalComposer${fullscreen ? " isFullscreen" : ""}`} action={action}>
      {heading && closeHref ? (
        <header className="originalComposerHeader">
          <h1>{heading}</h1>
          <Link className="originalComposerClose" href={closeHref} aria-label={tr("关闭编辑器")} title={tr("关闭编辑器")}>
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </header>
      ) : null}
      {hiddenFields.articleId ? <input type="hidden" name="articleId" value={hiddenFields.articleId} /> : null}
      {hiddenFields.slug ? <input type="hidden" name="slug" value={hiddenFields.slug} /> : null}
      {settings.publishNoticeText ? (
        <aside className="originalPublishNotice">
          <span>
            {tr(settings.publishNoticeText)}
            {settings.publishNoticeLinkLabel && settings.publishNoticeUrl ? <>{" "}<a href={settings.publishNoticeUrl}>{tr(settings.publishNoticeLinkLabel)}</a></> : null}
          </span>
        </aside>
      ) : null}
      <label className="originalComposerTitle">
        <span className="srOnly">{tr("标题")}</span>
        <input name="title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} required placeholder={tr("请输入标题")} />
      </label>

      <div className="originalComposerMeta">
        <div className="originalTagEditor" aria-label={tr("文章标签")}>
          {tags.map((tag) => (
            <button type="button" className="originalTagChip" key={tag} onClick={() => setTags((current) => current.filter((item) => item !== tag))} title={tr("移除标签")}>
              {tag}<span aria-hidden="true">×</span>
            </button>
          ))}
          <input
            value={tagDraft}
            maxLength={15}
            aria-invalid={Boolean(tagError)}
            aria-describedby={tagError ? "original-tag-error" : undefined}
            onChange={(event) => {
              setTagDraft(event.target.value);
              if (tagError) setTagError("");
            }}
            onFocus={() => setTagFocused(true)}
            onBlur={() => {
              window.setTimeout(() => setTagFocused(false), 120);
              commitTag();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "," || event.key === "，") {
                event.preventDefault();
                commitTag();
              } else if (event.key === "Backspace" && !tagDraft && tags.length) {
                setTags((current) => current.slice(0, -1));
              }
            }}
            placeholder={tags.length ? tr("继续添加标签") : tr("添加标签，回车确认")}
          />
          {tagFocused && tags.length < settings.maxTags && tagSuggestions.length ? (
            <div className="originalTagSuggestions" role="listbox" aria-label={tr("选择已有标签")}>
              {tagSuggestions.map((tag) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={tag.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitTag(tag.name)}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          ) : null}
          {tagError ? <small className="originalTagError" id="original-tag-error" role="alert">{tagError}</small> : null}
        </div>
        <input type="hidden" name="tags" value={tags.join(",")} />
        <label className="originalPriceControl">
          <span>{tr("售价")}</span>
          <input name="unlockSodaPrice" type="number" min={0} max={settings.maxArticlePrice} inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} />
          <span>{tr("苏打")}</span>
        </label>
      </div>

      <div className="originalComposerTabs">
        <div className="originalComposerViewTabs" role="tablist" aria-label={tr("编辑模式")}>
          <button type="button" role="tab" aria-selected={view === "write"} className={view === "write" ? "isActive" : ""} onClick={() => setView("write")}><PenLine size={14} aria-hidden="true" />{tr("编辑")}</button>
          {markdownEnabled ? (
            <>
            <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "isActive" : ""} onClick={() => setView("preview")}><Eye size={14} aria-hidden="true" />{tr("预览")}</button>
            <button type="button" role="tab" aria-selected={view === "split"} className={view === "split" ? "isActive" : ""} onClick={() => setView("split")}><Columns2 size={14} aria-hidden="true" />{tr("对照")}</button>
            </>
          ) : null}
        </div>
        <label className="settingToggle originalMarkdownToggle">
          <span>Markdown</span>
          <input
            type="checkbox"
            checked={markdownEnabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              setMarkdownEnabled(enabled);
              if (!enabled) setView("write");
            }}
            aria-label={tr("Markdown 排版辅助")}
          />
          <span className="settingToggleTrack" aria-hidden="true"><span /></span>
        </label>
        <button className="originalFullscreenToggle" type="button" aria-label={tr(fullscreen ? "退出全屏" : "全屏编辑")} title={tr(fullscreen ? "退出全屏" : "全屏编辑")} onClick={() => setFullscreen((current) => !current)}>
          {fullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </button>
      </div>

      <div className="originalComposerToolbar" aria-label={tr("格式工具")}>
        <button className={markerCount ? "isActive" : undefined} type="button" title={tr(markerCount ? "正文中已有付费分界" : "插入付费分界")} aria-label={tr("插入付费分界")} onMouseDown={(event) => event.preventDefault()} onClick={insertPaidDivider}>
          <BadgeDollarSign size={17} aria-hidden="true" />
        </button>
        {markdownEnabled ? MARK_ACTIONS.map((mark) => {
          const Icon = mark.icon;
          return (
            <button key={mark.label} type="button" title={tr(mark.label)} aria-label={tr(mark.label)} onMouseDown={(event) => event.preventDefault()} onClick={() => applyMark(mark)}>
              <Icon size={17} aria-hidden="true" />
            </button>
          );
        }) : null}
        {markdownEnabled ? <button type="button" title={tr("分隔线")} aria-label={tr("分隔线")} onMouseDown={(event) => event.preventDefault()} onClick={insertDivider}><Minus size={17} aria-hidden="true" /></button> : null}
      </div>

      <div className={`originalComposerSurface is-${view}`}>
        {view !== "preview" ? (
          <textarea
            ref={textareaRef}
            className="originalComposerSource"
            name="bodyMarkdown"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              if (editorError) setEditorError("");
            }}
            onKeyDown={handleEditorShortcut}
            maxLength={MAX_ORIGINAL_BODY_LENGTH}
            required
            placeholder={tr(markdownEnabled ? "在这里写下你的文章，使用上方工具辅助排版。" : "在这里写下你的文章。")}
            aria-label={tr("正文")}
          />
        ) : <textarea className="srOnly" name="bodyMarkdown" value={body} readOnly aria-hidden="true" />}
        {view !== "write" ? <Preview /> : null}
      </div>

      <footer className="originalComposerFooter">
        <div className="originalComposerStatus">
          <span>{feeHint}</span>
          {!articleReady ? <b>{tr(`正文至少需要 ${settings.articleMinWords.toLocaleString()} 字`)}</b> : null}
          {priceValue > 0 && !paidReady ? <b>{tr(markerCount === 0 ? "请插入付费分界" : markerCount > 1 ? "只能插入一个付费分界" : "分界前后都需要内容")}</b> : null}
          {editorError ? <b role="alert">{editorError}</b> : null}
        </div>
        <output className="originalBodyCount" aria-live="polite">{visibleWordCount.toLocaleString(locale === "zh-Hant" ? "zh-TW" : "zh-CN")} {tr("字")} · {body.length.toLocaleString(locale === "zh-Hant" ? "zh-TW" : "zh-CN")} / {MAX_ORIGINAL_BODY_LENGTH.toLocaleString(locale === "zh-Hant" ? "zh-TW" : "zh-CN")}</output>
        <button className="originalActionButton" type="submit" disabled={!paidReady || !articleReady}>{tr(mode === "create" ? "发布文章" : "保存文章")}</button>
      </footer>
    </form>
  );
}
