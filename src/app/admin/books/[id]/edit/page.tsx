import { BookOpenText, Layers3, PencilLine, Save, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminNovelContentEditor } from "@/components/AdminNovelContentEditor";
import { AdminNovelAccessFields } from "@/components/AdminNovelAccessFields";
import { getNovelById } from "@/lib/books";
import { getNovelSourceById, listNovelChaptersPage } from "@/lib/novel-library";
import { isNovelInRecommendationPool } from "@/lib/recommendation-pool";
import { getNovelRecommendationCount } from "@/lib/recommendations";
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
    returnPath?: string;
  }>;
};

function groupTags(group: TagGroup): TagWithCount[] {
  if (group.tags.length) {
    return group.tags;
  }
  return group.group ? [group.group] : [];
}

function safeReturnPath(value: string | undefined, bookId: number): string {
  if (!value || /[\r\n#\\]/.test(value)) {
    return "/admin/books";
  }
  if (value === "/admin/books" || value.startsWith("/admin/books?")) {
    return value;
  }
  return value === `/books/${bookId}` || value.startsWith(`/books/${bookId}?`) || value.startsWith(`/books/${bookId}/chapters/`)
    ? value
    : "/admin/books";
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
  const recommendationCount = getNovelRecommendationCount(book.id);
  const inRecommendationPool = isNovelInRecommendationPool(book.id);
  const source = book.source_id ? getNovelSourceById(book.source_id) : null;
  const chapterPreview = book.storage_mode === "chapters" ? listNovelChaptersPage(book.id, 1, 20) : null;
  const returnPath = safeReturnPath(query.returnPath, book.id);

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
            <p>{source?.name || "默认来源"} · {book.storage_mode === "chapters" ? `${book.chapter_count} 章` : book.file_name}</p>
          </div>
          <Link className="adminEditorReadLink" href={`/books/${book.id}`}>
            <BookOpenText size={16} aria-hidden="true" />
            阅读页
          </Link>
        </div>

        <form className="adminBookEditorForm" action={saveNovelEditorAction}>
          <input name="bookId" type="hidden" value={book.id} />
          <input name="returnPath" type="hidden" value={returnPath} />

          <section className="adminBookEditorSection">
            <h3><PencilLine size={16} aria-hidden="true" />基本信息</h3>
            <div className="adminBookBasicFields">
              <label>
                <span>小说名称</span>
                <input name="title" maxLength={120} defaultValue={book.title} required />
              </label>
              <label>
                <span>苏打推荐</span>
                <input
                  name="recommendationCount"
                  type="number"
                  min="0"
                  max="2000000000"
                  defaultValue={recommendationCount}
                />
              </label>
              <label className="adminBookDescriptionField">
                <span>书籍简介</span>
                <textarea
                  name="description"
                  rows={4}
                  maxLength={2000}
                  defaultValue={book.description}
                  placeholder="可选，将显示在阅读页的书详情中"
                />
              </label>
            </div>
            <label className="adminBookPoolToggle settingToggle">
              <input
                name="recommendationPool"
                type="checkbox"
                defaultChecked={inRecommendationPool}
              />
              <span className="adminBookPoolCopy">
                <strong><Sparkles size={15} aria-hidden="true" />精选推荐池</strong>
                <small>开启后，这本小说才会参与小说页的定时随机推荐。</small>
              </span>
              <span className="settingToggleTrack" aria-hidden="true"><span /></span>
            </label>
          </section>

          <section className="adminBookEditorSection">
            <h3>阅读权限</h3>
            <AdminNovelAccessFields
              accessMode={book.access_mode}
              sodaPrice={book.soda_price}
              previewChapterCount={book.preview_chapter_count}
              storageMode={book.storage_mode}
              chapterCount={book.chapter_count}
            />
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

          {chapterPreview ? (
            <section className="adminBookEditorSection adminNovelChapterSummary">
              <header>
                <h3><Layers3 size={16} aria-hidden="true" />章节</h3>
                <Link href={`/admin/books/${book.id}/chapters`}>管理章节</Link>
              </header>
              <div>
                {chapterPreview.chapters.map((chapter) => <span key={chapter.id}>{chapter.title}</span>)}
              </div>
            </section>
          ) : (
            <AdminNovelContentEditor bookId={book.id} />
          )}

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
