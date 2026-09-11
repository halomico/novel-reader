import { Eye, MessageCircle, Pin, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { AdminOriginalArticleActions } from "@/components/AdminOriginalArticleActions";
import { AdminOriginalBatchToolbar } from "@/components/AdminOriginalBatchToolbar";
import { AdminFrame } from "../AdminFrame";
import {
  deleteOriginalArticlesBatchAction,
  hideOriginalArticlesBatchAction,
  publishOriginalArticlesBatchAction,
} from "@/app/admin/original/actions";
import { getOriginalPublishingSettings, isOriginalChannelEnabled } from "@/lib/config";
import { listOriginalArticles, type OriginalArticleStatus } from "@/domains/originals/postgres-originals";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminOriginalPageProps = {
  searchParams: Promise<{ q?: string; page?: string; notice?: string; tone?: "success" | "warning" | "error" }>;
};

const statusLabel: Record<OriginalArticleStatus, string> = {
  published: "已发布",
  hidden: "已隐藏",
  draft: "草稿",
};

const accessLabel = {
  free: "免费",
  paid: "付费",
} as const;

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : value;
}

function statusBadgeClass(status: OriginalArticleStatus): string {
  if (status === "published") return "adminStatusBadge isLive";
  if (status === "draft") return "adminStatusBadge isPending";
  return "adminStatusBadge";
}

export default async function AdminOriginalPage({ searchParams }: AdminOriginalPageProps) {
  const params = await searchParams;
  const query = String(params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const result = await listOriginalArticles({
    includeUnpublished: true,
    query,
    page: Number(params.page || 1),
    pageSize: getOriginalPublishingSettings().pageSize,
    sort: "latest",
  });
  const returnPath = query ? `/admin/original?q=${encodeURIComponent(query)}${result.page > 1 ? `&page=${result.page}` : ""}` : result.page > 1 ? `/admin/original?page=${result.page}` : "/admin/original";
  const channelEnabled = isOriginalChannelEnabled();

  return (
    <AdminFrame active="original" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminOriginalPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>原创管理</h2>
            <p>审核发布状态、价格和互动数据；隐藏文章不会删除购买记录。</p>
          </div>
          <span className={channelEnabled ? "adminOriginalChannelState isOpen" : "adminOriginalChannelState"}>
            {channelEnabled ? "频道已开放" : "频道已关闭"}
          </span>
        </div>

        <form className="adminTagSearchForm adminOriginalSearch" method="get">
          <Search size={16} aria-hidden="true" />
          <input name="q" defaultValue={query} maxLength={80} placeholder="搜索标题或摘要" aria-label="搜索原创文章" />
          <button type="submit">搜索</button>
        </form>

        <div className="adminOriginalSummary">
          <span>共 {result.totalItems} 篇</span>
        </div>
        <AdminOriginalBatchToolbar
          formId="admin-original-batch"
          returnPath={returnPath}
          actions={[
            { label: "隐藏", icon: "hide", action: hideOriginalArticlesBatchAction, confirmMessage: "隐藏选中的文章吗？隐藏后不在原创页面显示，购买记录保留。" },
            { label: "恢复发布", icon: "publish", action: publishOriginalArticlesBatchAction },
            { label: "删除文章", icon: "delete", tone: "danger", action: deleteOriginalArticlesBatchAction, confirmMessage: "确定删除选中的原创文章吗？文章正文、评论、购买记录和阅读记录都会一并删除。" },
          ]}
        />

        <div className="adminTableWrap adminOriginalTableWrap">
          <table className="adminTable adminOriginalTable">
            <thead>
              <tr>
                <th className="adminOriginalSelectCell" aria-label="选择" />
                <th>文章</th>
                <th>作者</th>
                <th>状态</th>
                <th>访问</th>
                <th>数据</th>
                <th>更新</th>
                <th><span className="srOnly">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((article) => (
                <tr key={article.id}>
                  <td className="adminOriginalSelectCell">
                    <input
                      className="adminCheckbox"
                      type="checkbox"
                      name="articleIds"
                      value={article.id}
                      form="admin-original-batch"
                      data-batch-checkbox="admin-original-batch"
                      aria-label={`选择 ${article.title}`}
                    />
                  </td>
                  <td className="adminOriginalTitleCell">
                    <Link href={`/admin/original/${article.id}`} className="adminOriginalTitle">{article.title}</Link>
                    {article.isPinned ? <span className="adminOriginalPinned"><Pin size={12} fill="currentColor" aria-hidden="true" />已置顶</span> : null}
                    {article.excerpt ? <small>{article.excerpt}</small> : null}
                  </td>
                  <td>{article.authorName}</td>
                  <td><span className={statusBadgeClass(article.status)}>{statusLabel[article.status]}</span></td>
                  <td>{accessLabel[article.accessMode]}{article.unlockSodaPrice > 0 ? ` · ${article.unlockSodaPrice} 苏打` : ""}</td>
                  <td className="adminOriginalStatsCell">
                    <span><Eye size={13} aria-hidden="true" />{article.viewCount}</span>
                    <span><MessageCircle size={13} aria-hidden="true" />{article.commentCount}</span>
                  </td>
                  <td><time dateTime={article.updatedAt}>{dateLabel(article.updatedAt)}</time></td>
                  <td className="adminOriginalActionsCell">
                    <AdminOriginalArticleActions
                      articleId={article.id}
                      title={article.title}
                      status={article.status}
                      isPinned={article.isPinned}
                      returnPath={returnPath}
                    />
                  </td>
                </tr>
              ))}
              {!result.items.length ? (
                <tr><td colSpan={8}>没有匹配的文章。</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination page={result.page} totalPages={result.totalPages} query={query} basePath="/admin/original" />
      </article>
    </AdminFrame>
  );
}
