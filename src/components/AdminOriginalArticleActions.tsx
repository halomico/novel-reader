"use client";

import type { ReactNode } from "react";
import { Eye, EyeOff, Pin, Trash2 } from "lucide-react";
import {
  deleteOriginalArticleAction,
  setOriginalArticlePinnedAction,
  setOriginalArticleStatusAction,
} from "@/app/admin/original/actions";
import type { OriginalArticleStatus } from "@/domains/originals/postgres-originals";

export function AdminOriginalDeleteButton({
  articleId,
  title,
  returnPath,
  className = "adminTableIconButton isDanger",
  children,
}: {
  articleId: number;
  title: string;
  returnPath: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <form
      action={deleteOriginalArticleAction}
      onSubmit={(event) => {
        if (!window.confirm(`确定删除《${title}》吗？文章正文、评论、购买记录和阅读记录都会一并删除。`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="returnPath" value={returnPath} />
      <button className={className} type="submit" aria-label={`删除 ${title}`} title="删除文章">
        {children ?? <Trash2 size={15} aria-hidden="true" />}
      </button>
    </form>
  );
}

export function AdminOriginalArticleActions({
  articleId,
  title,
  status,
  isPinned,
  returnPath,
}: {
  articleId: number;
  title: string;
  status: OriginalArticleStatus;
  isPinned: boolean;
  returnPath: string;
}) {
  return (
    <div className="adminOriginalRowActions">
      {status === "published" || isPinned ? (
        <form action={setOriginalArticlePinnedAction}>
          <input type="hidden" name="articleId" value={articleId} />
          <input type="hidden" name="returnPath" value={returnPath} />
          <button
            className={`adminTableIconButton${isPinned ? " isPinned" : ""}`}
            type="submit"
            name="pinned"
            value={isPinned ? "0" : "1"}
            aria-label={isPinned ? `取消置顶 ${title}` : `置顶 ${title}`}
            title={isPinned ? "取消置顶" : "置顶"}
          >
            <Pin size={15} fill={isPinned ? "currentColor" : "none"} aria-hidden="true" />
          </button>
        </form>
      ) : null}
      <form action={setOriginalArticleStatusAction}>
        <input type="hidden" name="articleId" value={articleId} />
        <input type="hidden" name="returnPath" value={returnPath} />
        {status === "published" ? (
          <button className="adminTableIconButton" type="submit" name="status" value="hidden" aria-label={`隐藏 ${title}`} title="隐藏">
            <EyeOff size={15} aria-hidden="true" />
          </button>
        ) : (
          <button className="adminTableIconButton" type="submit" name="status" value="published" aria-label={`发布 ${title}`} title="发布">
            <Eye size={15} aria-hidden="true" />
          </button>
        )}
      </form>
      <AdminOriginalDeleteButton articleId={articleId} title={title} returnPath={returnPath} />
    </div>
  );
}
