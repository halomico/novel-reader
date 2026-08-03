import { ChevronDown, File, FolderCog, FolderPen, FolderPlus, Gauge, RefreshCw, Save, Search, Server, Trash2, UploadCloud } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { AdminMediaManager } from "@/components/AdminMediaManager";
import { AdminMediaSort } from "@/components/AdminMediaSort";
import { AdminVideoCategoryManager } from "@/components/AdminVideoCategoryManager";
import { AdminVideoTagManager } from "@/components/AdminVideoTagManager";
import { MediaFolderTree } from "@/components/MediaFolderTree";
import { Pagination } from "@/components/Pagination";
import {
  isMediaKind,
  listMediaAssets,
  listMediaFolders,
  listVideoCategories,
  listVideoTags,
  listVideoTagsForAssets,
  normalizeMediaSortBy,
  normalizeMediaSortOrder,
  sortMediaFolders,
  type MediaKind,
  type MediaSortBy,
  type MediaSortOrder,
} from "@/lib/media";
import { readSiteSettings } from "@/lib/site-settings";
import { MEDIA_UPLOAD_CHUNK_BYTES } from "@/lib/media-node-protocol";
import { getMediaStorageMode, listRemoteMediaNodes } from "@/lib/media-storage-config";
import { getActiveVideoTranscodeProfile } from "@/lib/video-transcode";
import {
  createAdminMediaFolderAction,
  deleteAdminMediaFolderAction,
  renameAdminMediaFolderAction,
  saveAdminMediaDisplaySettingsAction,
  syncAdminMediaAction,
} from "../actions";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";

type VideoAdminView = "assets" | "taxonomy" | "display";

type AdminMediaPageProps = {
  searchParams: Promise<{
    kind?: string;
    view?: string;
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

const VIDEO_VIEWS: Array<{ value: VideoAdminView; label: string }> = [
  { value: "assets", label: "资源" },
  { value: "taxonomy", label: "分类与标签" },
  { value: "display", label: "显示设置" },
];

function compatibleMediaSort(kind: MediaKind, sortBy: MediaSortBy): MediaSortBy {
  if (kind === "video" || kind === "audio") return sortBy === "size" ? "duration" : sortBy;
  return sortBy === "duration" || sortBy === "plays" ? "name" : sortBy;
}

function filterHref(kind: MediaKind, sortBy: MediaSortBy, sortOrder: MediaSortOrder): string {
  const nextSortBy = compatibleMediaSort(kind, sortBy);
  const nextSortOrder = nextSortBy === sortBy ? sortOrder : normalizeMediaSortOrder(undefined, nextSortBy);
  return `/admin/media?${new URLSearchParams({ kind, sort: nextSortBy, order: nextSortOrder }).toString()}`;
}

function viewHref(view: VideoAdminView): string {
  const params = new URLSearchParams({ kind: "video" });
  if (view !== "assets") params.set("view", view);
  return `/admin/media?${params.toString()}`;
}

function currentPath(
  kind: MediaKind,
  view: VideoAdminView,
  folder: string,
  query: string,
  sortBy: MediaSortBy,
  sortOrder: MediaSortOrder,
  category: string,
): string {
  const params = new URLSearchParams({ kind, sort: sortBy, order: sortOrder });
  if (kind === "video" && view !== "assets") params.set("view", view);
  if (folder) params.set("folder", folder);
  if (query) params.set("q", query);
  if (kind === "video" && category) params.set("category", category);
  return `/admin/media?${params.toString()}`;
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
  const view: VideoAdminView = kind === "video" && (params.view === "taxonomy" || params.view === "display")
    ? params.view
    : "assets";
  const requestedSortBy = normalizeMediaSortBy(params.sort);
  const sortBy = compatibleMediaSort(kind, requestedSortBy);
  const sortOrder = normalizeMediaSortOrder(params.order, sortBy);
  const categories = kind === "video" ? listVideoCategories({ includeHidden: true }) : [];
  const videoTags = kind === "video" ? listVideoTags({ includeHidden: true, pageSize: 5_000 }).tags : [];
  const requestedCategoryId = /^\d+$/.test(params.category || "") ? Number(params.category) : undefined;
  const categoryValue = kind === "video" && params.category === "none"
    ? null
    : kind === "video" && requestedCategoryId && categories.some((category) => category.id === requestedCategoryId)
      ? requestedCategoryId
      : undefined;
  const categoryParam = categoryValue === null ? "none" : categoryValue ? String(categoryValue) : "";

  const result = view === "assets"
    ? listMediaAssets({
        kind,
        videoCategoryId: categoryValue,
        folder: params.folder,
        query: params.q,
        page: Number(params.page || 1),
        pageSize: 20,
        sortBy,
        sortOrder,
      })
    : { assets: [], page: 1, totalPages: 1, totalAssets: 0, query: "", folder: "" };
  const kindFolders = view === "assets" ? listMediaFolders(kind) : [];
  const folders: Record<MediaKind, ReturnType<typeof listMediaFolders>> = {
    video: kind === "video" ? kindFolders : [],
    audio: kind === "audio" ? kindFolders : [],
    file: kind === "file" ? kindFolders : [],
  };
  const normalizedFolderTerms = result.query.normalize("NFKC").toLocaleLowerCase().split(" ").filter(Boolean);
  const folderSearchPrefix = result.folder ? `${result.folder}/` : "";
  const directFolders = view === "assets" ? sortMediaFolders(
    kindFolders.filter((item) => result.query
      ? item.path.startsWith(folderSearchPrefix) &&
        normalizedFolderTerms.every((term) => item.path.normalize("NFKC").toLocaleLowerCase().includes(term))
      : item.path.split("/").slice(0, -1).join("/") === result.folder),
    sortBy,
    sortOrder,
  ) : [];
  const returnPath = currentPath(kind, view, result.folder, result.query, sortBy, sortOrder, categoryParam);
  const currentFolderName = result.folder.split("/").at(-1) || "";
  const settings = readSiteSettings();
  const tagsByAsset = kind === "video" ? listVideoTagsForAssets(result.assets.map((asset) => asset.id)) : {};
  const mediaStorageMode = getMediaStorageMode();
  const mediaNodeCount = mediaStorageMode === "remote" ? listRemoteMediaNodes().length : 1;
  const videoTranscodeProfile = getActiveVideoTranscodeProfile();

  return (
    <AdminFrame active="media" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminMediaPanel">
        <div className="adminPanelHeader adminMediaPageHeader">
          <p className="adminMediaPageIntro">
            {view === "assets" ? "上传、整理与编辑媒体资源。" : view === "taxonomy" ? "维护视频频道与内容标签。" : "调整视频封面与相关推荐。"}
          </p>
          {view === "assets" ? (
            <Form className="adminTitleSearchForm" action="/admin/media">
              <Search size={17} aria-hidden="true" />
              <input name="q" defaultValue={result.query} placeholder={kind === "audio" ? "搜索标题、作者或文件名" : "搜索标题或文件名"} />
              <input name="kind" type="hidden" value={kind} />
              {result.folder ? <input name="folder" type="hidden" value={result.folder} /> : null}
              {categoryParam ? <input name="category" type="hidden" value={categoryParam} /> : null}
              <input name="sort" type="hidden" value={sortBy} />
              <input name="order" type="hidden" value={sortOrder} />
              <button type="submit">搜索</button>
            </Form>
          ) : null}
        </div>

        <div className="adminMediaToolbar">
          <nav className="adminMediaFilters" aria-label="资源类型筛选">
            {FILTERS.map((item) => (
              <Link className={item.kind === kind ? "isActive" : ""} href={filterHref(item.kind, sortBy, sortOrder)} key={item.kind}>
                {item.label}
              </Link>
            ))}
          </nav>
          {kind === "video" ? (
            <nav className="adminMediaViewTabs" aria-label="视频资源管理视图">
              {VIDEO_VIEWS.map((item) => (
                <Link className={item.value === view ? "isActive" : ""} href={viewHref(item.value)} key={item.value}>{item.label}</Link>
              ))}
            </nav>
          ) : null}
          {view === "assets" ? (
            <div className="adminMediaToolbarControls">
              <AdminMediaSort kind={kind} folder={result.folder} query={result.query} sortBy={sortBy} sortOrder={sortOrder} category={categoryParam} />
            </div>
          ) : null}
        </div>

        {kind === "video" && view === "assets" ? (
          <div className="adminMediaInfrastructure" aria-label="视频传输与处理配置">
            <span><UploadCloud size={14} aria-hidden="true" />{MEDIA_UPLOAD_CHUNK_BYTES / 1024 / 1024} MiB 分片直传</span>
            <span><Server size={14} aria-hidden="true" />{mediaNodeCount} 个媒体节点</span>
            <span><Gauge size={14} aria-hidden="true" />{videoTranscodeProfile?.label || "保留原码率"}</span>
          </div>
        ) : null}

        {kind === "video" && view === "taxonomy" ? (
          <div className="adminMediaTaxonomyLayout">
            <AdminVideoCategoryManager categories={categories} returnPath={returnPath} />
            <AdminVideoTagManager tags={videoTags} returnPath={returnPath} />
          </div>
        ) : null}

        {kind === "video" && view === "display" ? (
          <section className="adminMediaSettingsPanel">
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
                <span className="adminSelectControl">
                  <select name="relatedVideoMode" defaultValue={settings.relatedVideoMode}>
                    <option value="next">接下来的视频</option>
                    <option value="random">随机视频</option>
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </label>
              <button className="adminIconTextButton" type="submit"><Save size={15} aria-hidden="true" />保存</button>
            </form>
          </section>
        ) : null}

        {view === "assets" ? (
          <>
            {kind === "video" ? (
              <nav className="adminVideoCategoryTabs" aria-label="视频分类筛选">
                <Link className={!categoryParam ? "isActive" : ""} href={withMediaParam(returnPath, "category", "")}>全部</Link>
                {categories.map((category) => (
                  <Link className={categoryParam === String(category.id) ? "isActive" : ""} href={withMediaParam(returnPath, "category", String(category.id))} key={category.id}>
                    {category.name}<small>{category.videoCount}</small>{category.visible ? null : <span>隐藏</span>}
                  </Link>
                ))}
                <Link className={categoryParam === "none" ? "isActive" : ""} href={withMediaParam(returnPath, "category", "none")}>未分类</Link>
              </nav>
            ) : null}

            <div className="adminMediaWorkspace">
              <aside className="adminMediaFolderPanel">
                <div className="adminMediaFolderPanelHeader">
                  <strong>目录</strong>
                  <form action={syncAdminMediaAction}>
                    <input name="returnPath" type="hidden" value={returnPath} />
                    <button className="adminTableIconButton" type="submit" aria-label="立即同步媒体目录" title="同步目录">
                      <RefreshCw size={15} aria-hidden="true" />
                    </button>
                  </form>
                </div>
                <MediaFolderTree
                  kind={kind}
                  folders={kindFolders}
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
                          <button className="adminTableIconButton" type="submit" aria-label="新建目录" title="新建目录"><FolderPlus size={15} aria-hidden="true" /></button>
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
                              <button className="adminTableIconButton" type="submit" aria-label="保存目录名称" title="保存目录名称"><FolderPen size={15} aria-hidden="true" /></button>
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
                          <button className="adminDangerButton" type="submit"><Trash2 size={15} aria-hidden="true" />删除空目录</button>
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
                  videoTags={videoTags}
                  tagsByAsset={tagsByAsset}
                  categoryParam={categoryParam}
                />
                {!result.assets.length && !directFolders.length ? <div className="adminMediaEmpty"><File size={22} aria-hidden="true" />未找到资源。</div> : null}
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
          </>
        ) : null}
      </article>
    </AdminFrame>
  );
}
