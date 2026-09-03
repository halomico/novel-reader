import { Eye, FilePenLine, MessageCircle, Pin, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { AdminOriginalBatchToolbar } from "@/components/AdminOriginalBatchToolbar";
import { AdminFrame } from "../AdminFrame";
import { deleteOriginalArticlesBatchAction, setOriginalArticlePinnedAction, setOriginalArticleStatusAction } from "./actions";
import { isOriginalChannelEnabled } from "@/lib/config";
import { listOriginalArticles, type OriginalArticleStatus } from "@/lib/original";

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

export default async function AdminOriginalPage({ searchParams }: AdminOriginalPageProps) {
  const params = await searchParams;
  const query = String(params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const result = listOriginalArticles({ includeUnpublished: true, query, page: Number(params.page || 1), pageSize: 30, sort: "latest" });
  const returnPath = query ? `/admin/original?q=${encodeURIComponent(query)}${result.page > 1 ? `&page=${result.page}` : ""}` : result.page > 1 ? `/admin/original?page=${result.page}` : "/admin/original";
  const channelEnabled = isOriginalChannelEnabled();

  return (
    <AdminFrame active="original" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminOriginalPanel">
        <div className="adminPanelHeader">
          <div className="adminOriginalHeading">
            <FilePenLine size={30} strokeWidth={1.65} aria-hidden="true" />
            <div>
              <h2>原创管理</h2>
              <p>审核发布状态、价格和互动数据；隐藏文章不会删除购买记录。</p>
            </div>
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
          inputName="articleIds"
          returnPath={returnPath}
          action={deleteOriginalArticlesBatchAction}
          label="删除文章"
          confirmMessage="确定删除选中的原创文章吗？文章正文、评论、购买记录和阅读记录都会一并删除。"
        />

        <section className="adminOriginalList" aria-label="原创文章列表">
          {result.items.map((article) => (
            <article className="adminOriginalRow" key={article.id}>
              <input className="adminOriginalSelect" type="checkbox" name="articleIds" value={article.id} form="admin-original-batch" data-batch-checkbox="admin-original-batch" aria-label={`选择 ${article.title}`} />
              <div className="adminOriginalRowMain">
                <div className="adminOriginalTitleLine">
                  <Link href={`/admin/original/${article.id}`} className="adminOriginalTitle">{article.title}</Link>
                  {article.isPinned ? <span className="adminOriginalPinned"><Pin size={12} fill="currentColor" aria-hidden="true" />已置顶</span> : null}
                </div>
                <p>{article.excerpt || "暂无摘要"}</p>
                <div className="adminOriginalMeta">
                  <span>{article.authorName}</span>
                  <time dateTime={article.updatedAt}>{dateLabel(article.updatedAt)}</time>
                  <span><Eye size={13} aria-hidden="true" />{article.viewCount}</span>
                  <span><MessageCircle size={13} aria-hidden="true" />{article.commentCount}</span>
                  <span>{accessLabel[article.accessMode]}{article.unlockSodaPrice > 0 ? ` · ${article.unlockSodaPrice} 苏打` : ""}</span>
                </div>
              </div>
              <div className="adminOriginalRowActions">
                <span className={`adminIndexState is-${article.status}`}>{statusLabel[article.status]}</span>
                {(article.status === "published" || article.isPinned) ? (
                  <form action={setOriginalArticlePinnedAction}>
                    <input type="hidden" name="articleId" value={article.id} />
                    <input type="hidden" name="returnPath" value={returnPath} />
                    <button className={article.isPinned ? "isPinned" : ""} type="submit" name="pinned" value={article.isPinned ? "0" : "1"}>
                      <Pin size={13} fill={article.isPinned ? "currentColor" : "none"} aria-hidden="true" />
                      {article.isPinned ? "取消置顶" : "置顶"}
                    </button>
                  </form>
                ) : null}
                <form action={setOriginalArticleStatusAction}>
                  <input type="hidden" name="articleId" value={article.id} />
                  <input type="hidden" name="returnPath" value={returnPath} />
                  {article.status !== "published" ? <button type="submit" name="status" value="published">发布</button> : null}
                  {article.status !== "hidden" ? <button type="submit" name="status" value="hidden">隐藏</button> : null}
                  {article.status !== "draft" ? <button type="submit" name="status" value="draft">草稿</button> : null}
                </form>
              </div>
            </article>
          ))}
          {!result.items.length ? <p className="adminInlineMessage">没有匹配的文章。</p> : null}
        </section>
        <Pagination page={result.page} totalPages={result.totalPages} query={query} basePath="/admin/original" />
      </article>
    </AdminFrame>
  );
}
