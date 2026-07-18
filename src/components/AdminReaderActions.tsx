"use client";

import { Pencil, Pin, Trash2 } from "lucide-react";
import Link from "next/link";
import { deleteNovelsAction, togglePinnedNovelAction } from "@/app/admin/actions";

export function AdminReaderActions({ bookId, title, isPinned }: { bookId: number; title: string; isPinned: boolean }) {
  return (
    <div className="adminReaderActions" aria-label="管理员小说操作">
      <form action={togglePinnedNovelAction}>
        <input name="bookId" type="hidden" value={bookId} />
        <button
          className={isPinned ? "adminReaderPinButton isActive" : "adminReaderPinButton"}
          type="submit"
          aria-label={isPinned ? `取消置顶 ${title}` : `置顶 ${title}`}
          title={isPinned ? "取消置顶" : "置顶小说"}
        >
          <Pin size={16} fill={isPinned ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </form>
      <Link href={`/admin/books/${bookId}/edit`} aria-label={`编辑 ${title}`} title="编辑小说">
        <Pencil size={16} aria-hidden="true" />
      </Link>
      <form
        action={deleteNovelsAction}
        onSubmit={(event) => {
          if (!window.confirm(`确认删除《${title}》及其小说文件？`)) {
            event.preventDefault();
          }
        }}
      >
        <input name="bookIds" type="hidden" value={bookId} />
        <button className="adminReaderDeleteButton" type="submit" aria-label={`删除 ${title}`} title="删除小说">
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
