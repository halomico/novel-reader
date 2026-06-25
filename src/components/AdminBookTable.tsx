"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { deleteNovelsAction } from "@/app/admin/actions";
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

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
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
  const visibleIds = books.map((book) => book.id);
  const isAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  function toggleAll() {
    setSelectedIds(isAllSelected ? [] : visibleIds);
  }

  function toggleOne(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <form action={deleteNovelsAction}>
      <div className="adminTableWrap">
        <table className="adminTable">
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
              <th>
                <SortHeader label="书名" value="title" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="文件" value="file_name" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="大小" value="size_bytes" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="字数" value="word_count" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="更新时间" value="updated_at" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="访问量" value="visit_count" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="最后访问" value="last_accessed_at" query={query} sort={sort} dir={dir} />
              </th>
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
                  <td>
                    <strong>{book.title}</strong>
                  </td>
                  <td>{book.file_name}</td>
                  <td>{formatBytes(book.size_bytes)}</td>
                  <td>{book.word_count.toLocaleString("zh-CN")}</td>
                  <td>{formatDate(book.updated_at)}</td>
                  <td>{book.visit_count.toLocaleString("zh-CN")}</td>
                  <td>{formatDate(book.last_accessed_at)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>未找到匹配内容</td>
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
