"use client";

import { ArrowDown, ArrowUp, Pin, PinOff, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { savePinnedNovelsAction } from "@/app/admin/actions";
import type { PinnedNovel } from "@/lib/pinned-novels";

export function AdminPinnedBooks({ books, returnPath }: { books: PinnedNovel[]; returnPath: string }) {
  const sourceKey = useMemo(() => JSON.stringify(books.map((book) => [book.id, book.title])), [books]);
  const [orderedBooks, setOrderedBooks] = useState(books);
  const sourceIds = books.map((book) => book.id).join(",");
  const orderedIds = orderedBooks.map((book) => book.id).join(",");
  const dirty = sourceIds !== orderedIds;

  useEffect(() => {
    setOrderedBooks(books);
  }, [sourceKey]);

  function moveBook(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= orderedBooks.length) {
      return;
    }
    setOrderedBooks((current) => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function removeBook(id: number) {
    setOrderedBooks((current) => current.filter((book) => book.id !== id));
  }

  return (
    <details className="adminPinnedBooks" open={books.length > 0}>
      <summary>
        <Pin size={16} aria-hidden="true" />
        <span>置顶小说</span>
        <small>{orderedBooks.length}</small>
      </summary>
      <form action={savePinnedNovelsAction}>
        <input name="returnPath" type="hidden" value={returnPath} />
        {orderedBooks.map((book) => <input name="bookIds" type="hidden" value={book.id} key={book.id} />)}
        {orderedBooks.length ? (
          <ol>
            {orderedBooks.map((book, index) => (
              <li key={book.id}>
                <span className="adminPinnedOrder">{index + 1}</span>
                <Link href={`/books/${book.id}`} title={`阅读 ${book.title}`}>{book.title}</Link>
                <div className="adminPinnedActions">
                  <button type="button" disabled={index === 0} onClick={() => moveBook(index, -1)} aria-label={`上移 ${book.title}`} title="上移">
                    <ArrowUp size={15} aria-hidden="true" />
                  </button>
                  <button type="button" disabled={index === orderedBooks.length - 1} onClick={() => moveBook(index, 1)} aria-label={`下移 ${book.title}`} title="下移">
                    <ArrowDown size={15} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => removeBook(book.id)} aria-label={`取消置顶 ${book.title}`} title="取消置顶">
                    <PinOff size={15} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>{books.length ? "全部取消置顶将在保存后生效" : "暂无置顶小说"}</p>
        )}
        <footer className="adminPinnedFooter">
          <small>{dirty ? "调整尚未保存" : "顺序已保存"}</small>
          <button className="adminPinnedResetButton" type="button" disabled={!dirty} onClick={() => setOrderedBooks(books)} aria-label="撤销置顶调整" title="撤销调整">
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          <button className="adminIconTextButton" type="submit" disabled={!dirty}>
            <Save size={15} aria-hidden="true" />
            保存
          </button>
        </footer>
      </form>
    </details>
  );
}
