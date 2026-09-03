import { Eye, FilePenLine, MessageCircle, Pin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { OriginalEditorForm } from "@/components/OriginalEditorForm";
import { AdminOriginalBatchToolbar } from "@/components/AdminOriginalBatchToolbar";
import { OriginalMarkdown } from "@/components/OriginalMarkdown";
import { getOriginalPublishingSettings } from "@/lib/config";
import { getOriginalArticleById, listOriginalComments, listOriginalTags, type OriginalArticleStatus } from "@/lib/original";
import { AdminFrame } from "../../AdminFrame";
import {
  setOriginalArticleStatusAction,
  setOriginalArticlePinnedAction,
  setOriginalCommentStatusAdminAction,
  deleteOriginalCommentsBatchAction,
  updateOriginalArticleAdminAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminOriginalDetailProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }>;
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

export default async function AdminOriginalDetailPage({ params, searchParams }: AdminOriginalDetailProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const articleId = Number(id);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) notFound();
  const article = getOriginalArticleById(articleId, { includeUnpublished: true });
  if (!article) notFound();
  const settings = getOriginalPublishingSettings();
  const availableTags = listOriginalTags();
  const comments = listOriginalComments(article.id, { includeHidden: true });
  const returnPath = `/admin/original/${article.id}`;

  return (
    <AdminFrame
      active="original"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[{ label: "原创管理", href: "/admin/original" }, { label: article.title }]}
    >
      <article className="adminPanel adminOriginalEditorPanel">
        <header className="adminPanelHeader">
          <div className="adminOriginalHeading">
            <FilePenLine size={30} strokeWidth={1.65} aria-hidden="true" />
            <div>
              <h2>编辑原创文章</h2>
              <p>调整正文、价格和标签；管理员保存不扣除作者费用。</p>
            </div>
          </div>
          <Link className="adminSecondaryLink" href="/admin/original">返回列表</Link>
        </header>

        <section className="adminOriginalArticleSummary">
          <span className={`adminIndexState is-${article.status}`}>{statusLabel[article.status]}</span>
          {article.isPinned ? <span className="adminOriginalPinned"><Pin size={12} fill="currentColor" aria-hidden="true" />已置顶</span> : null}
          <span>{accessLabel[article.accessMode]}{article.unlockSodaPrice > 0 ? ` · ${article.unlockSodaPrice} 苏打` : ""}</span>
          <span><Eye size={13} aria-hidden="true" />{article.viewCount}</span>
          <span><MessageCircle size={13} aria-hidden="true" />{article.commentCount}</span>
          <time dateTime={article.updatedAt}>{dateLabel(article.updatedAt)}</time>
        </section>

        <OriginalEditorForm
          locale="zh-Hans"
          action={updateOriginalArticleAdminAction}
          settings={settings}
          article={article}
          mode="admin"
          hiddenFields={{ articleId: article.id }}
          availableTags={availableTags}
        />

        <section className="adminOriginalModeration">
          <header><div><h3><MessageCircle size={17} aria-hidden="true" />评论</h3><p>隐藏只影响前台展示，不删除原始记录。</p></div><span>{comments.length}</span></header>
          <AdminOriginalBatchToolbar
            formId={`admin-original-comments-${article.id}`}
            inputName="commentIds"
            returnPath={returnPath}
            action={deleteOriginalCommentsBatchAction}
            label="删除评论"
            confirmMessage="确定删除选中的评论吗？此操作不可恢复。"
            extraFields={{ articleId: String(article.id) }}
          />
          <div className="adminOriginalCommentList">
            {comments.map((comment) => (
              <article key={comment.id}>
                <input className="adminOriginalSelect" type="checkbox" name="commentIds" value={comment.id} form={`admin-original-comments-${article.id}`} data-batch-checkbox={`admin-original-comments-${article.id}`} aria-label={`选择 ${comment.authorName} 的评论`} />
                <div className="adminOriginalCommentBody">
                  <header><strong>{comment.authorName}</strong><time dateTime={comment.createdAt}>{dateLabel(comment.createdAt)}</time></header>
                  <OriginalMarkdown>{comment.bodyMarkdown}</OriginalMarkdown>
                </div>
                <form action={setOriginalCommentStatusAdminAction}>
                  <input type="hidden" name="commentId" value={comment.id} />
                  <input type="hidden" name="articleId" value={article.id} />
                  {comment.status === "hidden" ? <button type="submit" name="status" value="published">恢复</button> : <button type="submit" name="status" value="hidden">隐藏</button>}
                </form>
              </article>
            ))}
            {!comments.length ? <p className="adminInlineMessage">暂无评论。</p> : null}
          </div>
        </section>

        <section className="adminOriginalStatusActions" aria-label="文章状态">
          <span>文章管理</span>
          <div className="adminOriginalActionGroup">
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
              {article.status !== "draft" ? <button type="submit" name="status" value="draft">转草稿</button> : null}
            </form>
          </div>
        </section>
      </article>
    </AdminFrame>
  );
}
