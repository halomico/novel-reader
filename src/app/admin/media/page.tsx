import { ChevronDown, File, FolderCog, FolderPen, FolderPlus, ImageIcon, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { AdminMediaManager } from "@/components/AdminMediaManager";
import { AdminMediaSort } from "@/components/AdminMediaSort";
import { AdminVideoCategoryManager } from "@/components/AdminVideoCategoryManager";
import { MediaFolderTree } from "@/components/MediaFolderTree";
import { Pagination } from "@/components/Pagination";
import {
  isMediaKind,
  listMediaAssets,
  listMediaFolders,
  listVideoCategories,
  normalizeMediaSortBy,
  normalizeMediaSortOrder,
  sortMediaFolders,
  type MediaKind,
  type MediaSortBy,
  type MediaSortOrder,
} from "@/lib/media";
import { readSiteSettings } from "@/lib/site-settings";
import {
  createAdminMediaFolderAction,
  deleteAdminMediaFolderAction,
  renameAdminMediaFolderAction,
  saveAdminMediaDisplaySettingsAction,
  syncAdminMediaAction,
} from "../actions";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";

type AdminMediaPageProps = {
  searchParams: Promise<{
    kind?: string;
    folder?: string;
    q?: string;
    page?: string;
    sort?: string;
    order?: string;
    category?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

const FILTERS: Array<{ kind: MediaKind; label: string }> = [
  { kind: "video", label: "视频" },
  { kind: "audio", label: "音频" },
  { kind: "file", label: "文件" },
];

function compatibleMediaSort(kind: MediaKind, sortBy: MediaSortBy): MediaSortBy {
  if (kind === "video" || kind === "audio") {
    return sortBy === "size" ? "duration" : sortBy;
  }
  return sortBy === "duration" || sortBy === "plays" ? "name" : sortBy;
}

function filterHref(kind: MediaKind, sortBy: MediaSortBy, sortOrder: MediaSortOrder): string {
  const nextSortBy = compatibleMediaSort(kind, sortBy);
  const nextSortOrder = nextSortBy === sortBy ? sortOrder : normalizeMediaSortOrder(undefined, nextSortBy);
  return `/admin/media?${new URLSearchParams({ kind, sort: nextSortBy, order: nextSortOrder }).toString()}`;
}

function currentPath(
  kind: MediaKind,
  folder: string,
  query: string,
  sortBy: MediaSortBy,
  sortOrder: MediaSortOrder,
  category: string,
): string {
  const params = new URLSearchParams({ kind, sort: sortBy, order: sortOrder });
  if (folder) params.set("folder", folder);
  if (query) params.set("q", query);
  if (kind === "video" && category) params.set("category", category);
  const value = params.toString();
  return value ? `/admin/media?${value}` : "/admin/media";
}

function withMediaParam(pathValue: string, name: string, value: string): string {
  const params = new URLSearchParams(pathValue.split("?", 2)[1] || "");
  if (value) params.set(name, value);
  else params.delete(name);
  params.delete("page");
  return `/admin/media?${params.toString()}`;
}

export default async function AdminMediaPage({ searchParams }: AdminMediaPageProps) {
  const params = await searchParams;
  const kind = isMediaKind(params.kind) ? params.kind : "video";
  const requestedSortBy = normalizeMediaSortBy(params.sort);
  const sortBy = compatibleMediaSort(kind, requestedSortBy);
  const sortOrder = normalizeMediaSortOrder(params.order, sortBy);
  const categories = kind === "video" ? listVideoCategories({ includeHidden: true }) : [];
  const requestedCategoryId = /^\d+$/.test(params.category || "") ? Number(params.category) : undefined;
  const categoryValue = kind === "video" && params.category === "none"
    ? null
    : kind === "video" && requestedCategoryId && categories.some((category) => category.id === requestedCategoryId)
      ? requestedCategoryId
      : undefined;
  const categoryParam = categoryValue === null ? "none" : categoryValue ? String(categoryValue) : "";
  const result = listMediaAssets({
    kind,
    videoCategoryId: categoryValue,
    folder: params.folder,
    query: params.q,
    page: Number(params.page || 1),
    pageSize: 20,
    sortBy,
    sortOrder,
  });
  const folders: Record<MediaKind, ReturnType<typeof listMediaFolders>> = {
    video: kind === "video" ? listMediaFolders("video") : [],
    audio: kind === "audio" ? listMediaFolders("audio") : [],
    file: kind === "file" ? listMediaFolders("file") : [],
  };
  const normalizedFolderTerms = result.query.normalize("NFKC").toLocaleLowerCase().split(" ").filter(Boolean);
  const folderSearchPrefix = result.folder ? `${result.folder}/` : "";
  const directFolders = sortMediaFolders(
    folders[kind].filter((item) => result.query
      ? item.path.startsWith(folderSearchPrefix) &&
        normalizedFolderTerms.every((term) => item.path.normalize("NFKC").toLocaleLowerCase().includes(term))
      : item.path.split("/").slice(0, -1).join("/") === result.folder),
    sortBy,
    sortOrder,
  );
  const returnPath = currentPath(kind, result.folder, result.query, sortBy, sortOrder, categoryParam);
  const currentFolderName = result.folder.split("/").at(-1) || "";
  const settings = readSiteSettings();

  return (
    <AdminFrame active="media" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminMediaPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>资源管理</h2>
            <p>上传、编辑和统计视频、音频与文件。媒体由浏览器原生播放，不进行服务器转码。</p>
          </div>
          <Form className="adminTitleSearchForm" action="/admin/media">
            <Search size={17} aria-hidden="true" />
            <input name="q" defaultValue={result.query} placeholder="搜索标题、作者或文件名" />
            <input name="kind" type="hidden" value={kind} />
            {result.folder ? <input name="folder" type="hidden" value={result.folder} /> : null}
            {categoryParam ? <input name="category" type="hidden" value={categoryParam} /> : null}
            <input name="sort" type="hidden" value={sortBy} />
            <input name="order" type="hidden" value={sortOrder} />
            <button type="submit">搜索</button>
          </Form>
        </div>

        <div className="adminMediaToolbar">
          <nav className="adminMediaFilters" aria-label="资源类型筛选">
            {FILTERS.map((item) => (
              <Link className={item.kind === kind ? "isActive" : ""} href={filterHref(item.kind, sortBy, sortOrder)} key={item.label}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="adminMediaToolbarControls">
            <AdminMediaSort
              kind={kind}
              folder={result.folder}
              query={result.query}
              sortBy={sortBy}
              sortOrder={sortOrder}
              category={categoryParam}
            />
          </div>
        </div>

        {kind === "video" ? (
          <nav className="adminVideoCategoryTabs" aria-label="视频分类筛选">
            <Link className={!categoryParam ? "isActive" : ""} href={withMediaParam(returnPath, "category", "")}>全部视频</Link>
            {categories.map((category) => (
              <Link className={categoryParam === String(category.id) ? "isActive" : ""} href={withMediaParam(returnPath, "category", String(category.id))} key={category.id}>
                {category.name}<small>{category.videoCount}</small>{category.visible ? null : <span>隐藏</span>}
              </Link>
            ))}
            <Link className={categoryParam === "none" ? "isActive" : ""} href={withMediaParam(returnPath, "category", "none")}>未分类</Link>
          </nav>
        ) : null}

        {kind === "video" ? (
          <details className="adminMediaDisplaySettings">
            <summary><ImageIcon size={16} aria-hidden="true" />视频封面与推荐</summary>
            <form action={saveAdminMediaDisplaySettingsAction}>
              <input name="returnPath" type="hidden" value={returnPath} />
              <label>
                <span>封面截图位置 / %</span>
                <input name="videoThumbnailSinglePercent" type="number" min="1" max="99" defaultValue={settings.videoThumbnailSinglePercent} />
              </label>
              <label>
                <span>详情页推荐数量</span>
                <input name="relatedVideoCount" type="number" min="0" max="20" defaultValue={settings.relatedVideoCount} />
              </label>
              <label>
                <span>推荐方式</span>
                <select name="relatedVideoMode" defaultValue={settings.relatedVideoMode}>
                  <option value="next">接下来的视频</option>
                  <option value="random">随机视频</option>
                </select>
              </label>
              <button className="adminMediaSettingsSaveButton" type="submit" aria-label="保存视频封面与推荐设置" title="保存设置">
                <Save size={15} aria-hidden="true" />
              </button>
            </form>
          </details>
        ) : null}

        {kind === "video" ? <AdminVideoCategoryManager categories={categories} returnPath={returnPath} /> : null}

        <div className="adminMediaWorkspace">
          <aside className="adminMediaFolderPanel">
              <div className="adminMediaFolderPanelHeader">
                <strong>服务器目录</strong>
                <form action={syncAdminMediaAction}>
                  <input name="returnPath" type="hidden" value={returnPath} />
                  <button className="adminTableIconButton" type="submit" aria-label="立即同步媒体目录" title="立即同步媒体目录">
                    <RefreshCw size={15} aria-hidden="true" />
                  </button>
                </form>
              </div>
              <MediaFolderTree
                kind={kind}
                folders={folders[kind]}
                activeFolder={result.folder}
                basePath="/admin/media"
                query={result.query}
                sortBy={sortBy}
                sortOrder={sortOrder}
                category={categoryParam}
              />
              <details className="adminMediaFolderManager">
                <summary>
                  <span><FolderCog size={15} aria-hidden="true" />管理目录</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className="adminMediaFolderActions">
                  <form action={createAdminMediaFolderAction}>
                    <label>
                      <span>新建子目录</span>
                      <span className="adminMediaFolderInput">
                        <input name="folderName" maxLength={100} placeholder="目录名称" required />
                        <button className="adminTableIconButton" type="submit" aria-label="新建目录" title="新建目录">
                          <FolderPlus size={15} aria-hidden="true" />
                        </button>
                      </span>
                    </label>
                    <input name="kind" type="hidden" value={kind} />
                    <input name="parentFolder" type="hidden" value={result.folder} />
                    <input name="returnPath" type="hidden" value={returnPath} />
                  </form>
                  {result.folder ? (
                    <>
                      <form action={renameAdminMediaFolderAction} key={result.folder}>
                        <label>
                          <span>当前目录名称</span>
                          <span className="adminMediaFolderInput">
                            <input name="folderName" defaultValue={currentFolderName} maxLength={100} required />
                            <button className="adminTableIconButton" type="submit" aria-label="保存目录名称" title="保存目录名称">
                              <FolderPen size={15} aria-hidden="true" />
                            </button>
                          </span>
                        </label>
                        <input name="kind" type="hidden" value={kind} />
                        <input name="folder" type="hidden" value={result.folder} />
                        <input name="returnPath" type="hidden" value={returnPath} />
                      </form>
                      <form className="adminMediaDeleteFolderForm" action={deleteAdminMediaFolderAction}>
                        <input name="kind" type="hidden" value={kind} />
                        <input name="folder" type="hidden" value={result.folder} />
                        <input name="returnPath" type="hidden" value={returnPath} />
                        <button className="adminDangerButton" type="submit">
                          <Trash2 size={15} aria-hidden="true" />
                          删除空目录
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </details>
          </aside>
          <div className="adminMediaWorkspaceMain">
            <AdminMediaManager
              assets={result.assets}
              totalAssets={result.totalAssets}
              folders={folders}
              directFolders={directFolders}
              query={result.query}
              sortBy={sortBy}
              sortOrder={sortOrder}
              initialKind={kind}
              initialFolder={result.folder}
              returnPath={returnPath}
              categories={categories}
              categoryParam={categoryParam}
            />
            {!result.assets.length && !directFolders.length ? (
              <div className="adminMediaEmpty"><File size={22} aria-hidden="true" />未找到资源。</div>
            ) : null}
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              query={result.query}
              basePath="/admin/media"
              extraParams={{
                kind,
                folder: result.folder || undefined,
                sort: sortBy,
                order: sortOrder,
                category: categoryParam || undefined,
              }}
            />
          </div>
        </div>
      </article>
    </AdminFrame>
  );
}
