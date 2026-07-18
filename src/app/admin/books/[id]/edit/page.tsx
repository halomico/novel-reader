import { BookOpenText, PencilLine, Save } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminNovelContentEditor } from "@/components/AdminNovelContentEditor";
import { getNovelById } from "@/lib/books";
import { listHotwordsForNovel, listTagGroups, listTagsForNovel, type TagGroup, type TagWithCount } from "@/lib/tags";
import { saveNovelEditorAction } from "../../../actions";
import { AdminFrame } from "../../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminBookEditPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

function groupTags(group: TagGroup): TagWithCount[] {
  if (group.tags.length) {
    return group.tags;
  }
  return group.group ? [group.group] : [];
}

export default async function AdminBookEditPage({ params, searchParams }: AdminBookEditPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId < 1) {
    notFound();
  }

  const book = getNovelById(bookId);
  if (!book) {
    notFound();
  }

  const groups = listTagGroups({ includeHidden: true });
  const selectedTagIds = new Set(listTagsForNovel(book.id, { includeHidden: true }).map((tag) => tag.id));
  const hotwords = listHotwordsForNovel(book.id);

  return (
    <AdminFrame
      active="books"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[{ label: "小说管理", href: "/admin/books" }, { label: `编辑 ${book.title}` }]}
    >
      <article className="adminPanel adminBookEditorPanel">
        <div className="adminPanelHeader adminBookEditorHeader">
          <div>
            <h2>编辑小说</h2>
            <p>{book.file_name}</p>
          </div>
          <Link className="adminEditorReadLink" href={`/books/${book.id}`}>
            <BookOpenText size={16} aria-hidden="true" />
            阅读页
          </Link>
        </div>

        <form className="adminBookEditorForm" action={saveNovelEditorAction}>
          <input name="bookId" type="hidden" value={book.id} />

          <section className="adminBookEditorSection">
            <h3><PencilLine size={16} aria-hidden="true" />基本信息</h3>
            <label>
              <span>小说名称</span>
              <input name="title" maxLength={120} defaultValue={book.title} required />
            </label>
          </section>

          <section className="adminBookEditorSection adminBookTagChooser">
            <h3>文章标签</h3>
            {groups.length ? (
              <div className="adminBookTagGroups">
                {groups.map((group) => {
                  const tags = groupTags(group);
                  if (!tags.length) {
                    return null;
                  }
                  return (
                    <fieldset className="adminBookTagGroup" key={group.group?.id || "ungrouped"}>
                      <legend>{group.group?.name || "未分组"}</legend>
                      <div className="adminBookTagOptions">
                        {tags.map((tag) => (
                          <label className={tag.isVisible ? "adminBookTagOption" : "adminBookTagOption isMuted"} key={tag.id}>
                            <input name="tagIds" type="checkbox" value={tag.id} defaultChecked={selectedTagIds.has(tag.id)} />
                            <span>{tag.name}</span>
                            <small>{tag.directCount}</small>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            ) : (
              <p className="adminInlineMessage">
                还没有可选标签，先去 <Link href="/admin/tags">标签管理</Link> 创建。
              </p>
            )}
          </section>

          <section className="adminBookEditorSection">
            <label className="adminHotwordField">
              <span>文末热词</span>
              <textarea
                name="hotwords"
                rows={5}
                defaultValue={hotwords.join("\n")}
                placeholder="每行一个，也可用逗号分隔"
              />
              <small>阅读页中显示为全文搜索链接。</small>
            </label>
          </section>

          <AdminNovelContentEditor bookId={book.id} />

          <div className="adminEditorActions">
            <button type="submit">
              <Save size={15} aria-hidden="true" />
              保存
            </button>
          </div>
        </form>
      </article>
    </AdminFrame>
  );
}
