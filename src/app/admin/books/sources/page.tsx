import { BookOpenText, Folder, FolderPlus, Layers3, Save, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  createNovelSourceAction,
  deleteNovelSourceAction,
  saveNovelSourceAction,
} from "@/app/admin/actions";
import { getNovelSourceStoragePath, listNovelSources } from "@/lib/novel-library";
import { getNovelSourceSearchMode } from "@/lib/novel-search-policy";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type NovelSourcesPageProps = {
  searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function NovelSourcesPage({ searchParams }: NovelSourcesPageProps) {
  const query = await searchParams;
  const sources = listNovelSources({ includeEmpty: true });

  return (
    <AdminFrame
      active="books"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[{ label: "小说管理", href: "/admin/books" }, { label: "来源管理" }]}
    >
      <article className="adminPanel adminNovelSourcePanel">
        <header className="adminPanelHeader adminNovelSourceHeader">
          <div>
            <h2>来源管理</h2>
            <p>来源对应书库中的一级文件夹；可按书库决定是否加入全站正文索引，轻量书库仍可在具体书籍内搜索。</p>
          </div>
          <Link className="adminEditorReadLink" href="/admin/books">
            <BookOpenText size={15} aria-hidden="true" />返回小说
          </Link>
        </header>

        <form className="adminNovelSourceCreate" action={createNovelSourceAction}>
          <span className="adminNovelSourceCreateIcon"><FolderPlus size={20} aria-hidden="true" /></span>
          <label>
            <span>文件夹</span>
            <input name="folderName" maxLength={120} placeholder="例如：自建书库" required />
          </label>
          <label>
            <span>显示名称</span>
            <input name="name" maxLength={120} placeholder="留空则与文件夹相同" />
          </label>
          <button className="adminIconTextButton adminNovelSourceCreateButton" type="submit"><FolderPlus size={15} aria-hidden="true" />新建来源</button>
        </form>

        <section className="adminNovelSourceList" aria-label="小说来源列表">
          {sources.map((source) => {
            const isDefault = source.slug === "default";
            const searchMode = getNovelSourceSearchMode(source.slug);
            return (
              <form className="adminNovelSourceItem" action={saveNovelSourceAction} key={source.id}>
                <input name="sourceId" type="hidden" value={source.id} />
                <div className="adminNovelSourceIdentity">
                  <span className="adminNovelSourceFolderIcon"><Folder size={18} aria-hidden="true" /></span>
                  <span>
                    <strong>{getNovelSourceStoragePath(source)}</strong>
                    <small>{isDefault ? "默认来源 · 兼容根目录旧文件" : "一级来源目录"}</small>
                    <span className={`adminNovelSourceMode is-${searchMode}`}>{searchMode === "book" ? "轻量书库" : "普通书库"}</span>
                  </span>
                </div>
                <div className="adminNovelSourceStats" aria-label="来源内容统计">
                  <span><strong>{source.novelCount}</strong> 本</span>
                  <span><BookOpenText size={13} aria-hidden="true" />{source.singleNovelCount} 单文件</span>
                  <span><Layers3 size={13} aria-hidden="true" />{source.chapterNovelCount} 分章</span>
                </div>
                <label className="adminNovelSourceNameField">
                  <span>显示名称</span>
                  <input name="name" defaultValue={source.name} maxLength={120} required />
                </label>
                <label className="adminNovelSourceSearchField">
                  <span>正文搜索</span>
                  <select name="searchMode" defaultValue={searchMode}>
                    <option value="full">全站正文搜索</option>
                    <option value="book">仅本书搜索</option>
                  </select>
                </label>
                <label className="adminNovelSourceOrderField">
                  <span>顺序</span>
                  <input name="sortOrder" type="number" min={-10000} max={10000} defaultValue={source.sortOrder} />
                </label>
                <span className="adminNovelSourceActions">
                  <button className="adminTableIconButton" type="submit" title="保存来源" aria-label={`保存 ${source.name}`}>
                    <Save size={15} aria-hidden="true" />
                  </button>
                  {!isDefault && source.novelCount === 0 ? (
                    <button
                      className="adminTableIconButton isDanger"
                      type="submit"
                      formAction={deleteNovelSourceAction}
                      title="删除空来源"
                      aria-label={`删除 ${source.name}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              </form>
            );
          })}
        </section>
      </article>
    </AdminFrame>
  );
}
