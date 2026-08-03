import { BookOpenText, PencilLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminChapterManager } from "@/components/AdminChapterManager";
import { AdminChapterUpload } from "@/components/AdminChapterUpload";
import { Pagination } from "@/components/Pagination";
import { getNovelById } from "@/lib/books";
import { listNovelChaptersPage } from "@/lib/novel-library";
import { AdminFrame } from "../../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminChapterPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function AdminChapterPage({ params, searchParams }: AdminChapterPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const novelId = Number(id);
  if (!Number.isInteger(novelId) || novelId < 1) notFound();
  const book = getNovelById(novelId);
  if (!book || book.storage_mode !== "chapters") notFound();
  const chapterPage = listNovelChaptersPage(novelId, Number(query.page || 1), 50);

  return (
    <AdminFrame
      active="books"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[
        { label: "小说管理", href: "/admin/books" },
        { label: book.title, href: `/admin/books/${book.id}/edit` },
        { label: "章节" },
      ]}
    >
      <article className="adminPanel adminChapterPanel">
        <header className="adminPanelHeader adminChapterHeader">
          <div>
            <h2>{book.title}</h2>
            <p>共 {chapterPage.totalChapters} 章，可在这里追加、排序、改名或删除章节。</p>
          </div>
          <div className="adminChapterHeaderActions">
            <Link className="adminEditorReadLink" href={`/admin/books/${book.id}/edit`}><PencilLine size={15} aria-hidden="true" />编辑小说</Link>
            <Link className="adminEditorReadLink" href={`/books/${book.id}/chapters`}><BookOpenText size={15} aria-hidden="true" />阅读目录</Link>
          </div>
        </header>
        <AdminChapterUpload novelId={book.id} />
        <AdminChapterManager novelId={book.id} page={chapterPage.page} chapters={chapterPage.chapters} />
        <Pagination page={chapterPage.page} totalPages={chapterPage.totalPages} query="" basePath={`/admin/books/${book.id}/chapters`} />
      </article>
    </AdminFrame>
  );
}
