"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentIndexSummary } from "@/lib/content-index";

type AdminIndexTableProps = {
  indexes: ContentIndexSummary[];
};

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(status: string) {
  return status === "indexed" ? "已缓存" : "已跳过";
}

function sourceLabel(source: string) {
  return source === "manual" ? "手动" : "自动";
}

export function AdminIndexTable({ indexes }: AdminIndexTableProps) {
  const router = useRouter();
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const allSelected = indexes.length > 0 && selectedTerms.length === indexes.length;
  const selectedSet = useMemo(() => new Set(selectedTerms), [selectedTerms]);

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
              <th>关键词</th>
              <th>来源</th>
              <th>状态</th>
              <th>命中片段</th>
              <th>关联小说</th>
              <th>使用</th>
              <th>最后使用</th>
              <th>更新时间</th>
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
                  <td>{formatDate(item.lastUsedAt)}</td>
                  <td>{formatDate(item.updatedAt)}</td>
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
