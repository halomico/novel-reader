import { File, FolderPen, FolderPlus, ImageIcon, LibraryBig, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { AdminMediaManager } from "@/components/AdminMediaManager";
import { AdminMediaSort } from "@/components/AdminMediaSort";
import { MediaFolderTree } from "@/components/MediaFolderTree";
import { Pagination } from "@/components/Pagination";
import {
  isMediaKind,
  listMediaAssets,
  listMediaFolders,
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
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

const FILTERS: Array<{ kind?: MediaKind; label: string }> = [
  { label: "全部" },
  { kind: "video", label: "视频" },
  { kind: "audio", label: "音频" },
  { kind: "file", label: "文件" },
];

function filterHref(kind: MediaKind | undefined, sortBy: MediaSortBy, sortOrder: MediaSortOrder): string {
  const params = new URLSearchParams({ sort: sortBy, order: sortOrder });
  if (kind) params.set("kind", kind);
  return `/admin/media?${params.toString()}`;
}

function currentPath(kind: MediaKind | undefined, folder: string, query: string, sortBy: MediaSortBy, sortOrder: MediaSortOrder): string {
  const params = new URLSearchParams({ sort: sortBy, order: sortOrder });
  if (kind) params.set("kind", kind);
  if (folder) params.set("folder", folder);
  if (query) params.set("q", query);
  const value = params.toString();
  return value ? `/admin/media?${value}` : "/admin/media";
}

export default async function AdminMediaPage({ searchParams }: AdminMediaPageProps) {
  const params = await searchParams;
  const kind = isMediaKind(params.kind) ? params.kind : undefined;
  const sortBy = normalizeMediaSortBy(params.sort);
  const sortOrder = normalizeMediaSortOrder(params.order, sortBy);
  const result = listMediaAssets({
    kind,
    folder: params.folder,
    query: params.q,
    page: Number(params.page || 1),
    pageSize: 20,
    sortBy,
    sortOrder,
  });
  const folders = {
    video: listMediaFolders("video"),
    audio: listMediaFolders("audio"),
    file: listMediaFolders("file"),
  };
  const directFolders = kind
    ? sortMediaFolders(
        folders[kind].filter((item) => item.path.split("/").slice(0, -1).join("/") === result.folder),
        sortBy,
        sortOrder,
      )
    : [];
  const returnPath = currentPath(kind, result.folder, result.query, sortBy, sortOrder);
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
          <form className="adminTitleSearchForm" action="/admin/media">
            <Search size={17} aria-hidden="true" />
            <input name="q" defaultValue={result.query} placeholder="搜索标题、作者或文件名" />
            {kind ? <input name="kind" type="hidden" value={kind} /> : null}
            {result.folder ? <input name="folder" type="hidden" value={result.folder} /> : null}
            <input name="sort" type="hidden" value={sortBy} />
            <input name="order" type="hidden" value={sortOrder} />
            <button type="submit">搜索</button>
          </form>
        </div>

        <div className="adminMediaToolbar">
          <nav className="adminMediaFilters" aria-label="资源类型筛选">
            {FILTERS.map((item) => (
              <Link className={item.kind === kind || (!item.kind && !kind) ? "isActive" : ""} href={filterHref(item.kind, sortBy, sortOrder)} key={item.label}>
                {item.kind ? null : <LibraryBig size={15} aria-hidden="true" />}
                {item.label}
              </Link>
            ))}
          </nav>
          <AdminMediaSort kind={kind} folder={result.folder} query={result.query} sortBy={sortBy} sortOrder={sortOrder} />
        </div>

        {!kind || kind === "video" ? (
          <details className="adminMediaDisplaySettings">
            <summary><ImageIcon size={16} aria-hidden="true" />视频封面与推荐</summary>
            <form action={saveAdminMediaDisplaySettingsAction}>
              <input name="returnPath" type="hidden" value={returnPath} />
              <label>
                <span>封面模式</span>
                <select name="videoThumbnailMode" defaultValue={settings.videoThumbnailMode}>
                  <option value="single">单图</option>
                  <option value="carousel">轮播图</option>
                </select>
              </label>
              <label>
                <span>单图截图位置 / %</span>
                <input name="videoThumbnailSinglePercent" type="number" min="1" max="99" defaultValue={settings.videoThumbnailSinglePercent} />
              </label>
              <label>
                <span>轮播张数</span>
                <input name="videoThumbnailCarouselFrames" type="number" min="2" max="8" defaultValue={settings.videoThumbnailCarouselFrames} />
              </label>
              <label>
                <span>每张停留 / 秒</span>
                <input name="videoThumbnailCarouselIntervalSeconds" type="number" min="1" max="15" defaultValue={settings.videoThumbnailCarouselIntervalSeconds} />
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

        <div className={kind ? "adminMediaWorkspace" : "adminMediaWorkspace withoutFolders"}>
          {kind ? (
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
              />
              <div className="adminMediaFolderActions">
                <form action={createAdminMediaFolderAction}>
                  <input name="kind" type="hidden" value={kind} />
                  <input name="parentFolder" type="hidden" value={result.folder} />
                  <input name="returnPath" type="hidden" value={returnPath} />
                  <input name="folderName" maxLength={100} placeholder="新建子文件夹" aria-label="新建子文件夹名称" required />
                  <button className="adminTableIconButton" type="submit" aria-label="新建文件夹" title="新建文件夹">
                    <FolderPlus size={15} aria-hidden="true" />
                  </button>
                </form>
                {result.folder ? (
                  <>
                    <form action={renameAdminMediaFolderAction} key={result.folder}>
                      <input name="kind" type="hidden" value={kind} />
                      <input name="folder" type="hidden" value={result.folder} />
                      <input name="returnPath" type="hidden" value={returnPath} />
                      <input name="folderName" defaultValue={currentFolderName} maxLength={100} aria-label="文件夹新名称" required />
                      <button className="adminTableIconButton" type="submit" aria-label="重命名文件夹" title="重命名文件夹">
                        <FolderPen size={15} aria-hidden="true" />
                      </button>
                    </form>
                    <form className="adminMediaDeleteFolderForm" action={deleteAdminMediaFolderAction}>
                      <input name="kind" type="hidden" value={kind} />
                      <input name="folder" type="hidden" value={result.folder} />
                      <input name="returnPath" type="hidden" value={returnPath} />
                      <button className="adminTableIconButton" type="submit" aria-label="删除空文件夹" title="删除空文件夹">
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            </aside>
          ) : null}
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
            />
            {!result.assets.length && !directFolders.length ? (
              <div className="adminMediaEmpty"><File size={22} aria-hidden="true" />未找到资源。</div>
            ) : null}
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              query={result.query}
              basePath="/admin/media"
              extraParams={{ kind, folder: result.folder || undefined, sort: sortBy, order: sortOrder }}
            />
          </div>
        </div>
      </article>
    </AdminFrame>
  );
}
