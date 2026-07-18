import { ArrowDown, ArrowUp, Pin, PinOff } from "lucide-react";
import Link from "next/link";
import { movePinnedNovelAction, togglePinnedNovelAction } from "@/app/admin/actions";
import type { PinnedNovel } from "@/lib/pinned-novels";

export function AdminPinnedBooks({ books }: { books: PinnedNovel[] }) {
  return (
    <details className="adminPinnedBooks" open={books.length > 0}>
      <summary>
        <Pin size={16} aria-hidden="true" />
        <span>置顶小说</span>
        <small>{books.length}</small>
      </summary>
      {books.length ? (
        <ol>
          {books.map((book, index) => (
            <li key={book.id}>
              <span className="adminPinnedOrder">{index + 1}</span>
              <Link href={`/books/${book.id}`} title={`阅读 ${book.title}`}>{book.title}</Link>
              <div className="adminPinnedActions">
                <form action={movePinnedNovelAction}>
                  <input name="bookId" type="hidden" value={book.id} />
                  <input name="direction" type="hidden" value="up" />
                  <button type="submit" disabled={index === 0} aria-label={`上移 ${book.title}`} title="上移">
                    <ArrowUp size={15} aria-hidden="true" />
                  </button>
                </form>
                <form action={movePinnedNovelAction}>
                  <input name="bookId" type="hidden" value={book.id} />
                  <input name="direction" type="hidden" value="down" />
                  <button type="submit" disabled={index === books.length - 1} aria-label={`下移 ${book.title}`} title="下移">
                    <ArrowDown size={15} aria-hidden="true" />
                  </button>
                </form>
                <form action={togglePinnedNovelAction}>
                  <input name="bookId" type="hidden" value={book.id} />
                  <button type="submit" aria-label={`取消置顶 ${book.title}`} title="取消置顶">
                    <PinOff size={15} aria-hidden="true" />
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p>暂无置顶小说</p>
      )}
    </details>
  );
}
