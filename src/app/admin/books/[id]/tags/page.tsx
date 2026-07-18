import { Tags } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { saveNovelTaggingAction } from "../../../actions";
import { AdminFrame } from "../../../AdminFrame";
import { getNovelById } from "@/lib/books";
import { listHotwordsForNovel, listTagGroups, listTagsForNovel, type TagGroup, type TagWithCount } from "@/lib/tags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminBookTagPageProps = {
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

export default async function AdminBookTagPage({ params, searchParams }: AdminBookTagPageProps) {
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
      breadcrumbs={[{ label: "小说管理", href: "/admin/books" }, { label: book.title }]}
    >
      <article className="adminPanel adminBookTagPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>{book.title}</h2>
            <p>给这本书维护标签和文末热词；热词会跳转到全文搜索。</p>
          </div>
          <Tags size={20} aria-hidden="true" />
        </div>

        <form className="adminSettingsSection adminBookTagForm" action={saveNovelTaggingAction}>
          <input name="bookId" type="hidden" value={book.id} />
          <section className="adminBookTagChooser">
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

          <label className="adminHotwordField">
            <span>文末热词</span>
            <textarea
              name="hotwords"
              rows={6}
              defaultValue={hotwords.join("\n")}
              placeholder="每行一个热词，也可以用逗号分隔；每个热词 2-15 字"
            />
            <small>保存后阅读页底部展示为下划线链接，点击进入全文搜索。</small>
          </label>

          <button type="submit">保存</button>
        </form>
      </article>
    </AdminFrame>
  );
}
