import { Search } from "lucide-react";
import type { Metadata } from "next";
import { AdminSearchIndexManager } from "@/components/AdminSearchIndexManager";
import { LocalDateTime } from "@/components/LocalDateTime";
import { shouldShowProgressBars } from "@/lib/config";
import {
  getContentSearchCombinedSummary,
  getLegacyContentSearchDiskUsage,
  listContentSearchSourceSummaries,
} from "@/lib/content-search-sources";
import { getDb } from "@/lib/db";
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
    tone?: "success" | "warning" | "error";
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

export default async function AdminIndexesPage({ searchParams }: AdminIndexesPageProps) {
  const params = await searchParams;
  const db = getDb();
  const sources = listContentSearchSourceSummaries(db);
  const summary = getContentSearchCombinedSummary(db);
  const legacyBytes = getLegacyContentSearchDiskUsage();

  return (
    <AdminFrame active="indexes" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminIndexPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>搜索索引</h2>
            <p>每个普通书库使用独立索引分片；轻量书库不会写入全文索引。</p>
          </div>
          <Search size={20} aria-hidden="true" />
        </div>

        <div className="adminStats">
          <div className="adminStatCard">
            <span>索引覆盖</span>
            <strong>{summary.indexedBooks} / {summary.totalBooks}</strong>
          </div>
          <div className="adminStatCard">
            <span>待更新</span>
            <strong>{summary.pendingBooks}</strong>
          </div>
          <div className="adminStatCard">
            <span>失败</span>
            <strong>{summary.failedBooks}</strong>
          </div>
          <div className="adminStatCard">
            <span>原文体积</span>
            <strong>{formatBytes(summary.sourceBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <span>索引体积</span>
            <strong>{formatBytes(summary.databaseBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <span>体积比例</span>
            <strong>{summary.databaseRatio.toFixed(2)}x</strong>
          </div>
        </div>

        <div className="adminSearchIndexMeta">
          <span>结构版本 v{summary.indexVersion}</span>
          <span>失效 {summary.staleBooks} 本</span>
          <span>最近完成：<LocalDateTime value={summary.lastIndexedAt} /></span>
        </div>

        {legacyBytes > 0 ? (
          <p className="adminIndexLegacyNotice">检测到旧版共享索引 {formatBytes(legacyBytes)}。缺少新分片的书库会临时只读使用它；所有分片构建完成后即可安全删除并释放空间。</p>
        ) : null}

        <AdminSearchIndexManager showProgressBars={shouldShowProgressBars()} sources={sources} legacyBytes={legacyBytes} />
      </article>
    </AdminFrame>
  );
}
