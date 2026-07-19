import { PencilLine, Save, Tags } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNovelById, type Novel } from "@/lib/books";
import { listTagGroups, type TagGroup, type TagWithCount } from "@/lib/tags";
import { batchUpdateNovelsAction } from "../../actions";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type AdminBookBatchPageProps = {
  searchParams: Promise<{
    ids?: string;
    returnPath?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

function safeReturnPath(value: string | undefined): string {
  return value && (value === "/admin/books" || value.startsWith("/admin/books?")) && !/[\r\n#\\]/.test(value)
    ? value
    : "/admin/books";
}

function groupTags(group: TagGroup): TagWithCount[] {
  return group.tags.length ? group.tags : group.group ? [group.group] : [];
}

export default async function AdminBookBatchPage({ searchParams }: AdminBookBatchPageProps) {
  const query = await searchParams;
  const ids = Array.from(new Set(
    String(query.ids || "")
      .split(",")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  )).slice(0, 100);
  const books = ids.map((id) => getNovelById(id)).filter((book): book is Novel => Boolean(book));
  if (!books.length) {
    notFound();
  }
  const groups = listTagGroups({ includeHidden: true });
  const returnPath = safeReturnPath(query.returnPath);

  return (
    <AdminFrame
      active="books"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[{ label: "小说管理", href: returnPath }, { label: "批量编辑" }]}
    >
      <article className="adminPanel adminBookBatchPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>批量编辑</h2>
            <p>已选择 {books.length} 本；标签和热词会追加，已有内容不会被覆盖。</p>
          </div>
        </div>

        <form className="adminBookBatchForm" action={batchUpdateNovelsAction}>
          <input name="returnPath" type="hidden" value={returnPath} />
          <section className="adminBookEditorSection">
            <h3><PencilLine size={16} aria-hidden="true" />小说名称</h3>
            <div className="adminBatchTitleList">
              {books.map((book) => (
                <label key={book.id}>
                  <span>{book.file_name}</span>
                  <input name={`title-${book.id}`} defaultValue={book.title} maxLength={120} required />
                  <input name="bookIds" type="hidden" value={book.id} />
                </label>
              ))}
            </div>
          </section>

          <section className="adminBookEditorSection adminBookTagChooser">
            <h3><Tags size={16} aria-hidden="true" />追加文章标签</h3>
            <div className="adminBookTagGroups">
              {groups.map((group) => {
                const tags = groupTags(group);
                return tags.length ? (
                  <fieldset className="adminBookTagGroup" key={group.group?.id || "ungrouped"}>
                    <legend>{group.group?.name || "未分组"}</legend>
                    <div className="adminBookTagOptions">
                      {tags.map((tag) => (
                        <label className={tag.isVisible ? "adminBookTagOption" : "adminBookTagOption isMuted"} key={tag.id}>
                          <input name="tagIds" type="checkbox" value={tag.id} />
                          <span>{tag.name}</span>
                          <small>{tag.directCount}</small>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null;
              })}
            </div>
          </section>

          <section className="adminBookEditorSection">
            <label className="adminHotwordField">
              <span>追加文末热词</span>
              <textarea name="hotwords" rows={4} placeholder="每行一个，也可用逗号分隔；留空则不修改" />
            </label>
          </section>

          <div className="adminEditorActions">
            <button type="submit"><Save size={15} aria-hidden="true" />保存</button>
          </div>
        </form>
      </article>
    </AdminFrame>
  );
}
