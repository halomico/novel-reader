import type { Metadata } from "next";
import { AdminSearchIndexManager } from "@/components/AdminSearchIndexManager";
import { LocalDateTime } from "@/components/LocalDateTime";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { readPostgresContentIndexStatus } from "@/domains/reading/postgres-content-status";
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
  const [params, settings] = await Promise.all([searchParams, readPostgresSiteSettings()]);
  const { sources, summary } = await readPostgresContentIndexStatus(
    database("web"),
    settings.novelSourceSearchModes,
  );

  return (
    <AdminFrame active="indexes" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminIndexPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>搜索索引</h2>
            <p>正文以 PostgreSQL 分代在线发布；全站搜索与本书搜索共用一致、可回滚的数据版本。</p>
          </div>
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
            <span>PostgreSQL 占用</span>
            <strong>{formatBytes(summary.databaseBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <span>体积比例</span>
            <strong>{summary.databaseRatio.toFixed(2)}x</strong>
          </div>
        </div>

        <div className="adminSearchIndexMeta">
          <span>中文归一化版本 v{summary.normalizationVersion}</span>
          <span>失效 {summary.staleBooks} 本</span>
          <span>最近完成：<LocalDateTime value={summary.lastIndexedAt} /></span>
        </div>

        <AdminSearchIndexManager showProgressBars={settings.showProgressBars} sources={sources} />
      </article>
    </AdminFrame>
  );
}
