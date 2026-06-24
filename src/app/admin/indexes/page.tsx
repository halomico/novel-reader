import { Search } from "lucide-react";
import type { Metadata } from "next";
import { Pagination } from "@/components/Pagination";
import { AdminIndexBuilder } from "@/components/AdminIndexBuilder";
import { AdminIndexTable } from "@/components/AdminIndexTable";
import {
  getAdminIndexPageSize,
  getContentIndexMaxSegments,
  getManualIndexMaxSegments,
  isManualIndexMaxSegmentsEnabled,
  shouldShowProgressBars,
} from "@/lib/config";
import { getContentIndexStorageSummary, listContentIndexTerms } from "@/lib/content-index";
import { getContentIndexDb } from "@/lib/content-index-db";
import { matchesParsedSearchQuery, parseSearchQuery } from "@/lib/search-query";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminIndexesPageProps = {
  searchParams: Promise<{
    notice?: string;
    page?: string;
    tone?: "success" | "warning" | "error";
    q?: string;
  }>;
};

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function normalizePage(value: string | undefined, totalPages: number): number {
  const page = Number(value || "1");
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

export default async function AdminIndexesPage({ searchParams }: AdminIndexesPageProps) {
  const params = await searchParams;
  const indexDb = getContentIndexDb();
  const allIndexes = listContentIndexTerms(indexDb);
  const query = (params.q || "").trim();
  const validation = query ? parseSearchQuery(query, { mode: "index" }) : null;
  const indexes = validation?.ok ? allIndexes.filter((item) => matchesParsedSearchQuery(item.term, validation.query)) : allIndexes;
  const pageSize = getAdminIndexPageSize();
  const totalPages = Math.max(1, Math.ceil(indexes.length / pageSize));
  const page = normalizePage(params.page, totalPages);
  const pageIndexes = indexes.slice((page - 1) * pageSize, page * pageSize);
  const message = validation && !validation.ok ? validation.message : "";
  const storage = getContentIndexStorageSummary(indexDb);
  const maxSegments = getContentIndexMaxSegments();
  const manualLimitEnabled = isManualIndexMaxSegmentsEnabled();
  const manualMaxSegments = getManualIndexMaxSegments();
  const showProgressBars = shouldShowProgressBars();

  return (
    <AdminFrame active="indexes" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminIndexPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>搜索索引</h2>
            <p>全局正文搜索可自动缓存冷词；手动添加索引时会显示扫描进度。</p>
          </div>
          <Search size={20} aria-hidden="true" />
        </div>

        <div className="adminStats">
          <div className="adminStatCard">
            <span>索引库</span>
            <strong>{formatBytes(storage.databaseBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <span>软上限</span>
            <strong>{formatBytes(storage.softLimitBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <span>硬上限</span>
            <strong>{formatBytes(storage.hardLimitBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <span>索引词</span>
            <strong>{storage.termCount}</strong>
          </div>
        </div>

        <AdminIndexBuilder
          autoMaxSegments={maxSegments}
          manualLimitEnabled={manualLimitEnabled}
          manualMaxSegments={manualMaxSegments}
          showProgressBars={showProgressBars}
        />

        <form className="adminTitleSearchForm adminIndexSearchForm" action="/admin/indexes">
          <Search size={16} aria-hidden="true" />
          <input name="q" defaultValue={query} placeholder='查询索引词，支持 AND / OR / NOT / "短语"' />
          <button type="submit">查询</button>
        </form>
        {message ? <p className="adminInlineMessage">{message}</p> : null}

        <AdminIndexTable indexes={message ? [] : pageIndexes} />
        {!message ? <Pagination page={page} totalPages={totalPages} query={query} basePath="/admin/indexes" /> : null}
      </article>
    </AdminFrame>
  );
}
