import { Search } from "lucide-react";
import type { Metadata } from "next";
import { AdminSearchIndexManager } from "@/components/AdminSearchIndexManager";
import { LocalDateTime } from "@/components/LocalDateTime";
import { shouldShowProgressBars } from "@/lib/config";
import { getContentSearchDb } from "@/lib/content-search-db";
import { getContentSearchIndexSummary } from "@/lib/content-search-index";
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
  const summary = getContentSearchIndexSummary(getDb(), getContentSearchDb());

  return (
    <AdminFrame active="indexes" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminIndexPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>搜索索引</h2>
            <p>中文双字使用二元索引，三字以上使用 FTS5 三元索引。</p>
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

        <AdminSearchIndexManager showProgressBars={shouldShowProgressBars()} />
      </article>
    </AdminFrame>
  );
}
