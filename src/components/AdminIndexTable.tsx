"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalDateTime } from "@/components/LocalDateTime";
import type { ContentIndexSummary } from "@/lib/content-index";

export type AdminIndexSortKey =
  | "term"
  | "source"
  | "status"
  | "segmentCount"
  | "novelCount"
  | "hitCount"
  | "lastUsedAt"
  | "updatedAt";
export type AdminIndexSortDir = "asc" | "desc";

type AdminIndexTableProps = {
  indexes: ContentIndexSummary[];
  query: string;
  sort: AdminIndexSortKey;
  dir: AdminIndexSortDir;
};

function sortHref(query: string, sort: AdminIndexSortKey, dir: AdminIndexSortDir, nextSort: AdminIndexSortKey) {
  const params = new URLSearchParams();
  params.set("page", "1");
  if (query) {
    params.set("q", query);
  }
  params.set("sort", nextSort);
  params.set("dir", sort === nextSort && dir === "asc" ? "desc" : "asc");
  return `/admin/indexes?${params.toString()}`;
}

function SortHeader({
  label,
  value,
  query,
  sort,
  dir,
}: {
  label: string;
  value: AdminIndexSortKey;
  query: string;
  sort: AdminIndexSortKey;
  dir: AdminIndexSortDir;
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

function statusLabel(status: string) {
  return status === "indexed" ? "已缓存" : "已跳过";
}

function sourceLabel(source: string) {
  return source === "manual" ? "手动" : "自动";
}

export function AdminIndexTable({ indexes, query, sort, dir }: AdminIndexTableProps) {
  const router = useRouter();
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const allSelected = indexes.length > 0 && indexes.every((item) => selectedTerms.includes(item.term));
  const selectedSet = useMemo(() => new Set(selectedTerms), [selectedTerms]);

  useEffect(() => {
    setSelectedTerms([]);
  }, [indexes]);

  function toggleAll() {
    setSelectedTerms(allSelected ? [] : indexes.map((item) => item.term));
  }

  function toggleTerm(term: string) {
    setSelectedTerms((current) => (current.includes(term) ? current.filter((item) => item !== term) : [...current, term]));
  }

  async function deleteTerms(terms: string[]) {
    if (!terms.length || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setMessage("");
    try {
      const response = await fetch("/admin/indexes/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", terms }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string; deleted?: string[] };
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "删除索引失败");
      }
      setSelectedTerms((current) => current.filter((term) => !data.deleted?.includes(term)));
      setMessage(`已删除 ${data.deleted?.length || 0} 个索引词`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除索引失败");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <div className="adminTableToolbar">
        <button className="adminIconTextButton" type="button" disabled={!selectedTerms.length || isDeleting} onClick={() => deleteTerms(selectedTerms)}>
          <Trash2 size={15} aria-hidden="true" />
          删除选中
        </button>
        {message ? <span>{message}</span> : null}
      </div>
      <div className="adminTableWrap">
        <table className="adminTable">
          <thead>
            <tr>
              <th>
                <input className="adminCheckbox" type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选索引词" />
              </th>
              <th>
                <SortHeader label="关键词" value="term" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="来源" value="source" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="状态" value="status" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="命中片段" value="segmentCount" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="关联小说" value="novelCount" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="使用" value="hitCount" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="最后使用" value="lastUsedAt" query={query} sort={sort} dir={dir} />
              </th>
              <th>
                <SortHeader label="更新时间" value="updatedAt" query={query} sort={sort} dir={dir} />
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {indexes.length ? (
              indexes.map((item) => (
                <tr key={item.term}>
                  <td>
                    <input
                      className="adminCheckbox"
                      type="checkbox"
                      checked={selectedSet.has(item.term)}
                      onChange={() => toggleTerm(item.term)}
                      aria-label={`选择 ${item.term}`}
                    />
                  </td>
                  <td title={item.term}>{item.term}</td>
                  <td>{sourceLabel(item.source)}</td>
                  <td>
                    <span className={item.status === "indexed" ? "adminIndexStatus isIndexed" : "adminIndexStatus isSkipped"}>
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td>{item.segmentCount}</td>
                  <td>{item.novelCount}</td>
                  <td>{item.hitCount}</td>
                  <td>
                    <LocalDateTime value={item.lastUsedAt} />
                  </td>
                  <td>
                    <LocalDateTime value={item.updatedAt} />
                  </td>
                  <td>
                    <button className="adminIconTextButton" type="button" disabled={isDeleting} onClick={() => deleteTerms([item.term])}>
                      <Trash2 size={15} aria-hidden="true" />
                      删除
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10}>暂无匹配索引。全局正文搜索或手动添加后会出现在这里。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
