"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { deleteNovelsAction } from "@/app/admin/actions";
import { LocalDateTime } from "@/components/LocalDateTime";
import type { AdminBookSortDir, AdminBookSortKey } from "@/lib/admin-books";
import type { Novel } from "@/lib/books";

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function sortHref(query: string, sort: AdminBookSortKey, dir: AdminBookSortDir, nextSort: AdminBookSortKey) {
  const params = new URLSearchParams();
  params.set("page", "1");
  if (query) {
    params.set("q", query);
  }
  params.set("sort", nextSort);
  params.set("dir", sort === nextSort && dir === "asc" ? "desc" : "asc");
  return `/admin/books?${params.toString()}`;
}

function SortHeader({
  label,
  value,
  query,
  sort,
  dir,
}: {
  label: string;
  value: AdminBookSortKey;
  query: string;
  sort: AdminBookSortKey;
  dir: AdminBookSortDir;
}) {
  const isActive = sort === value;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <Link className={isActive ? "adminSortLink isActive" : "adminSortLink"} href={sortHref(query, sort, dir, value)}>
      <span>{label}</span>
      <Icon size={13} aria-hidden="true" />
    </Link>
  );
}

type BookColumnKey = "title" | "file" | "size" | "words" | "updated" | "visits" | "lastAccessed" | "lastIp" | "lastUa";

type BookColumn = {
  key: BookColumnKey;
  label: string;
  visible: boolean;
  sort?: AdminBookSortKey;
};

const BOOK_COLUMN_STORAGE_KEY = "novel-reader-admin-book-columns";
const BOOK_COLUMN_WIDTH_STORAGE_KEY = "novel-reader-admin-book-column-widths";
const BOOK_TEXT_MODE_STORAGE_KEY = "novel-reader-admin-book-text-mode";
const BOOK_SELECT_COLUMN_WIDTH = 42;
const MIN_BOOK_COLUMN_WIDTH = 76;
const MAX_BOOK_COLUMN_WIDTH = 720;

type BookTextMode = "full" | "truncate";

const DEFAULT_BOOK_COLUMNS: BookColumn[] = [
  { key: "title", label: "书名", visible: true, sort: "title" },
  { key: "file", label: "文件", visible: true, sort: "file_name" },
  { key: "size", label: "大小", visible: true, sort: "size_bytes" },
  { key: "words", label: "字数", visible: true, sort: "word_count" },
  { key: "updated", label: "更新时间", visible: true, sort: "updated_at" },
  { key: "visits", label: "访问量", visible: true, sort: "visit_count" },
  { key: "lastAccessed", label: "最后访问", visible: true, sort: "last_accessed_at" },
  { key: "lastIp", label: "最后访问 IP", visible: true },
  { key: "lastUa", label: "最后访问 UA", visible: false },
];

const DEFAULT_BOOK_COLUMN_WIDTHS: Record<BookColumnKey, number> = {
  title: 220,
  file: 260,
  size: 96,
  words: 96,
  updated: 170,
  visits: 92,
  lastAccessed: 170,
  lastIp: 152,
  lastUa: 340,
};

function mergeStoredColumns(value: string | null): BookColumn[] {
  if (!value) {
    return DEFAULT_BOOK_COLUMNS;
  }

  try {
    const parsed = JSON.parse(value) as Array<{ key: BookColumnKey; visible: boolean }>;
    const byKey = new Map(DEFAULT_BOOK_COLUMNS.map((column) => [column.key, column]));
    const merged = parsed
      .map((column) => {
        const defaultColumn = byKey.get(column.key);
        if (!defaultColumn) {
          return null;
        }
        byKey.delete(column.key);
        return { ...defaultColumn, visible: Boolean(column.visible) };
      })
      .filter((column): column is BookColumn => Boolean(column));
    return [...merged, ...Array.from(byKey.values())];
  } catch {
    return DEFAULT_BOOK_COLUMNS;
  }
}

function serializeColumns(columns: BookColumn[]): string {
  return JSON.stringify(columns.map((column) => ({ key: column.key, visible: column.visible })));
}

function mergeStoredColumnWidths(value: string | null): Record<BookColumnKey, number> {
  if (!value) {
    return DEFAULT_BOOK_COLUMN_WIDTHS;
  }

  try {
    const parsed = JSON.parse(value) as Partial<Record<BookColumnKey, number>>;
    const next = { ...DEFAULT_BOOK_COLUMN_WIDTHS };
    for (const column of DEFAULT_BOOK_COLUMNS) {
      const width = Number(parsed[column.key]);
      if (Number.isFinite(width)) {
        next[column.key] = Math.min(Math.max(Math.floor(width), MIN_BOOK_COLUMN_WIDTH), MAX_BOOK_COLUMN_WIDTH);
      }
    }
    return next;
  } catch {
    return DEFAULT_BOOK_COLUMN_WIDTHS;
  }
}

function normalizeTextMode(value: string | null): BookTextMode {
  return value === "truncate" ? "truncate" : "full";
}

export function AdminBookTable({
  books,
  page,
  totalPages,
  totalBooks,
  query,
  sort,
  dir,
}: {
  books: Novel[];
  page: number;
  totalPages: number;
  totalBooks: number;
  query: string;
  sort: AdminBookSortKey;
  dir: AdminBookSortDir;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [columns, setColumns] = useState<BookColumn[]>(DEFAULT_BOOK_COLUMNS);
  const [columnWidths, setColumnWidths] = useState<Record<BookColumnKey, number>>(DEFAULT_BOOK_COLUMN_WIDTHS);
  const [textMode, setTextMode] = useState<BookTextMode>("full");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [resizingColumn, setResizingColumn] = useState<{ key: BookColumnKey; startX: number; startWidth: number } | null>(null);
  const visibleIds = books.map((book) => book.id);
  const isAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const visibleColumns = columns.filter((column) => column.visible);
  const tableMinWidth =
    BOOK_SELECT_COLUMN_WIDTH + visibleColumns.reduce((total, column) => total + (columnWidths[column.key] || DEFAULT_BOOK_COLUMN_WIDTHS[column.key]), 0);

  useEffect(() => {
    try {
      setColumns(mergeStoredColumns(localStorage.getItem(BOOK_COLUMN_STORAGE_KEY)));
      setColumnWidths(mergeStoredColumnWidths(localStorage.getItem(BOOK_COLUMN_WIDTH_STORAGE_KEY)));
      setTextMode(normalizeTextMode(localStorage.getItem(BOOK_TEXT_MODE_STORAGE_KEY)));
    } catch {
      setColumns(DEFAULT_BOOK_COLUMNS);
      setColumnWidths(DEFAULT_BOOK_COLUMN_WIDTHS);
      setTextMode("full");
    }
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }
    try {
      localStorage.setItem(BOOK_COLUMN_STORAGE_KEY, serializeColumns(columns));
      localStorage.setItem(BOOK_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
      localStorage.setItem(BOOK_TEXT_MODE_STORAGE_KEY, textMode);
    } catch {
      // Column preferences are optional; the table still works without storage.
    }
  }, [columnWidths, columns, preferencesLoaded, textMode]);

  useEffect(() => {
    if (!resizingColumn) {
      return;
    }
    const activeResize = resizingColumn;

    function handlePointerMove(event: PointerEvent) {
      const nextWidth = Math.min(Math.max(activeResize.startWidth + event.clientX - activeResize.startX, MIN_BOOK_COLUMN_WIDTH), MAX_BOOK_COLUMN_WIDTH);
      setColumnWidths((current) => ({ ...current, [activeResize.key]: Math.floor(nextWidth) }));
    }

    function stopResize() {
      setResizingColumn(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [resizingColumn]);

  function toggleAll() {
    setSelectedIds(isAllSelected ? [] : visibleIds);
  }

  function toggleOne(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleColumn(key: BookColumnKey) {
    setColumns((current) => {
      const visibleCount = current.filter((column) => column.visible).length;
      return current.map((column) => {
        if (column.key !== key) {
          return column;
        }
        if (column.visible && visibleCount <= 1) {
          return column;
        }
        return { ...column, visible: !column.visible };
      });
    });
  }

  function moveColumn(key: BookColumnKey, direction: -1 | 1) {
    setColumns((current) => {
      const index = current.findIndex((column) => column.key === key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [column] = next.splice(index, 1);
      next.splice(nextIndex, 0, column);
      return next;
    });
  }

  function startColumnResize(event: ReactPointerEvent<HTMLButtonElement>, key: BookColumnKey) {
    event.preventDefault();
    setResizingColumn({
      key,
      startX: event.clientX,
      startWidth: columnWidths[key] || DEFAULT_BOOK_COLUMN_WIDTHS[key],
    });
  }

  function renderHeaderLabel(column: BookColumn) {
    if (column.sort) {
      return <SortHeader label={column.label} value={column.sort} query={query} sort={sort} dir={dir} />;
    }
    return (
      <span className="adminPlainHeader" title={column.label}>
        {column.label}
      </span>
    );
  }

  function renderHeader(column: BookColumn) {
    return (
      <div className="adminResizableHeader">
        <span className="adminHeaderContent">{renderHeaderLabel(column)}</span>
        <button className="adminColumnResizeHandle" type="button" aria-label={`调整${column.label}列宽`} title="拖动调整列宽" onPointerDown={(event) => startColumnResize(event, column.key)}>
          <GripVertical size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }

  function renderCell(book: Novel, column: BookColumn) {
    if (column.key === "title") {
      return <strong>{book.title}</strong>;
    }
    if (column.key === "file") {
      return book.file_name;
    }
    if (column.key === "size") {
      return formatBytes(book.size_bytes);
    }
    if (column.key === "words") {
      return book.word_count.toLocaleString("zh-CN");
    }
    if (column.key === "updated") {
      return <LocalDateTime value={book.updated_at} />;
    }
    if (column.key === "visits") {
      return book.visit_count.toLocaleString("zh-CN");
    }
    if (column.key === "lastAccessed") {
      return <LocalDateTime value={book.last_accessed_at} />;
    }
    if (column.key === "lastIp") {
      return book.last_accessed_ip || "-";
    }
    return book.last_accessed_user_agent || "-";
  }

  return (
    <form className={resizingColumn ? "adminBookTableForm isResizing" : "adminBookTableForm"} action={deleteNovelsAction}>
      <div className="adminTableToolbar adminBookTableToolbar">
        <span>共 {totalBooks} 本小说</span>
        <div className="tableColumnControl">
          <button
            className="adminIconButton"
            type="button"
            aria-label="调整表格列"
            title="调整表格列"
            onClick={() => setColumnPanelOpen((open) => !open)}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
          </button>
          {columnPanelOpen ? (
            <div className="tableColumnPanel">
              <div className="tableTextModeControl" role="group" aria-label="文本显示方式">
                <button className={textMode === "full" ? "isActive" : ""} type="button" onClick={() => setTextMode("full")} title="完整显示">
                  <Maximize2 size={14} aria-hidden="true" />
                  <span>完整</span>
                </button>
                <button className={textMode === "truncate" ? "isActive" : ""} type="button" onClick={() => setTextMode("truncate")} title="省略显示">
                  <Minimize2 size={14} aria-hidden="true" />
                  <span>省略</span>
                </button>
              </div>
              <div className="tableColumnPanelDivider" />
              {columns.map((column, index) => (
                <div className="tableColumnItem" key={column.key}>
                  <button type="button" aria-label={column.visible ? `隐藏${column.label}` : `显示${column.label}`} onClick={() => toggleColumn(column.key)}>
                    {column.visible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
                  </button>
                  <span>{column.label}</span>
                  <button type="button" aria-label={`上移${column.label}`} disabled={index === 0} onClick={() => moveColumn(column.key, -1)}>
                    <ChevronUp size={15} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`下移${column.label}`} disabled={index === columns.length - 1} onClick={() => moveColumn(column.key, 1)}>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="adminTableWrap adminBookTableWrap">
        <table className={textMode === "truncate" ? "adminTable adminBookTable isTruncated" : "adminTable adminBookTable isFullText"} style={{ minWidth: `max(100%, ${tableMinWidth}px)` }}>
          <colgroup>
            <col style={{ width: BOOK_SELECT_COLUMN_WIDTH }} />
            {visibleColumns.map((column) => (
              <col key={column.key} style={{ width: columnWidths[column.key] || DEFAULT_BOOK_COLUMN_WIDTHS[column.key] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th aria-label="选择小说">
                <input
                  className="adminCheckbox"
                  type="checkbox"
                  checked={isAllSelected}
                  disabled={visibleIds.length === 0}
                  onChange={toggleAll}
                  aria-label={isAllSelected ? "取消全选" : "全选当前页"}
                />
              </th>
              {visibleColumns.map((column) => (
                <th className="adminResizableTh" key={column.key}>
                  {renderHeader(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {books.length > 0 ? (
              books.map((book) => (
                <tr key={book.id}>
                  <td>
                    <input
                      className="adminCheckbox"
                      type="checkbox"
                      name="bookIds"
                      value={book.id}
                      checked={selectedIds.includes(book.id)}
                      onChange={() => toggleOne(book.id)}
                      aria-label={`选择 ${book.title}`}
                    />
                  </td>
                  {visibleColumns.map((column) => (
                    <td
                      className={column.key === "lastUa" ? "adminTableWideCell" : undefined}
                      key={`${book.id}-${column.key}`}
                      title={column.key === "lastIp" ? book.last_accessed_ip || "" : column.key === "lastUa" ? book.last_accessed_user_agent || "" : undefined}
                    >
                      {renderCell(book, column)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={visibleColumns.length + 1}>未找到匹配内容</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="adminTableFooter">
        <button className="adminDangerButton" type="submit" disabled={selectedIds.length === 0}>
          <Trash2 size={17} aria-hidden="true" />
          删除所选
        </button>
        <span>
          第 {page} / {totalPages} 页，共 {totalBooks} 本
        </span>
      </div>
    </form>
  );
}
