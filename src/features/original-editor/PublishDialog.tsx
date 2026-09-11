"use client";

import { Check, Search, Tags, X } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { isValidOriginalTagName, normalizeOriginalTagName } from "@/lib/original-constants";
import type { OriginalComposerTag } from "./composer-document";
import styles from "./OriginalComposer.module.css";

export function PublishDialog({
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
      {errorMessage ? <DismissibleNotice message={errorMessage} tone="error" variant="search" displaySeconds={5} /> : null}
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
              <div className={styles.fieldRow}>
                <label htmlFor="publish-soda-price" className={styles.fieldLabel}>
                  价格
                </label>
                <span className={styles.priceControl}>
                  <input
                    id="publish-soda-price"
                    type="number"
                    min={1}
                    max={1_000_000}
                    inputMode="numeric"
                    value={price}
                    onChange={(event) => onPrice(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                  />
                  <span>苏打</span>
                </span>
              </div>
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
