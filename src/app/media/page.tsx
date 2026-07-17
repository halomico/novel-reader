import { ChevronRight, Clapperboard, Disc3, File, Headphones, Search, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaFolderRow } from "@/components/MediaFolderRow";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { getVideoThumbnailSettings } from "@/lib/config";
import {
  getAccessibleMediaKinds,
  isMediaKind,
  listMediaAssets,
  listMediaFolders,
  listVideoCategories,
  type MediaAsset,
  type MediaKind,
} from "@/lib/media";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";
import { formatMediaDuration } from "@/lib/media-metadata";
import { getCurrentUser } from "@/lib/user-auth";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export const dynamic = "force-dynamic";

type MediaPageProps = {
  searchParams: Promise<{ kind?: string; folder?: string; q?: string; page?: string; category?: string }>;
};

const KIND_LABELS: Record<MediaKind, string> = { video: "视频", audio: "音频", file: "文件" };
const KIND_ICONS = { video: Clapperboard, audio: Headphones, file: File };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function displayTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase()) ? title.slice(0, -extension.length) : title;
}

function mediaHref(kind: MediaKind, folder = "", query = "", category = ""): string {
  const params = new URLSearchParams({ kind });
  if (folder) params.set("folder", folder);
  if (query) params.set("q", query);
  if (kind === "video" && category) params.set("category", category);
  return `/media?${params.toString()}`;
}

function MediaResourceRow({ asset, showFolder }: { asset: MediaAsset; showFolder: boolean }) {
  const title = displayTitle(asset.title, asset.fileName);
  const Icon = asset.kind === "audio" ? Disc3 : File;
  const metadata = [
    asset.kind === "audio" ? asset.artist || "未知作者" : asset.description || "文件",
    showFolder && asset.folder ? asset.folder : "",
  ].filter(Boolean).join(" · ");

  return (
    <Link className="mediaResourceRow" href={`/media/${asset.id}`}>
      <span className={`mediaAssetIcon is-${asset.kind}`} aria-hidden="true"><Icon size={21} /></span>
      <span className="mediaCardCopy">
        <strong title={title}>{title}</strong>
        <small title={metadata}>{metadata}</small>
      </span>
      <span className="mediaCardSize">{asset.kind === "audio" ? formatMediaDuration(asset.durationSeconds) : formatBytes(asset.sizeBytes)}</span>
      <ChevronRight size={17} aria-hidden="true" />
    </Link>
  );
}

export default async function MediaPage({ searchParams }: MediaPageProps) {
  const user = await getCurrentUser();
  const accessibleKinds = getAccessibleMediaKinds(Boolean(user));
  if (!accessibleKinds.length) notFound();
  const params = await searchParams;
  const requestedKind = isMediaKind(params.kind) ? params.kind : null;
  if (requestedKind && !accessibleKinds.includes(requestedKind)) notFound();
  const kind = requestedKind || accessibleKinds[0];
  const videoCategories = kind === "video" ? listVideoCategories() : [];
  const requestedCategoryId = /^\d+$/.test(params.category || "") ? Number(params.category) : undefined;
  const videoCategoryId = requestedCategoryId && videoCategories.some((category) => category.id === requestedCategoryId)
    ? requestedCategoryId
    : undefined;
  const categoryParam = videoCategoryId ? String(videoCategoryId) : "";
  const result = listMediaAssets({
    kind,
    videoCategoryId,
    folder: kind === "video" ? "" : params.folder,
    recursive: kind === "video",
    query: params.q,
    page: Number(params.page || 1),
    pageSize: 18,
  });
  scheduleMediaPreparation(result.assets);
  const thumbnailSettings = getVideoThumbnailSettings();
  const folders = kind === "video" ? [] : listMediaFolders(kind);
  const EmptyIcon = KIND_ICONS[kind];
  const segments = result.folder ? result.folder.split("/") : [];
  const childFolders = result.query ? [] : folders.filter((folder) => folder.path.split("/").slice(0, -1).join("/") === result.folder);
  const visibleItems = result.totalAssets + childFolders.length;

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: KIND_LABELS[kind] }]} />
      <section className="mediaLibrary">
        <header className="mediaLibraryHeader">
          <span className="mediaLibraryTitleIcon" aria-hidden="true"><EmptyIcon size={23} /></span>
          <div>
            <h1>{KIND_LABELS[kind]}</h1>
            <p>共 {visibleItems.toLocaleString("zh-CN")} 项</p>
          </div>
        </header>

        {kind === "video" && videoCategories.length ? (
          <nav className="mediaVideoChannels" aria-label="视频分类">
            <Link className={!categoryParam ? "isActive" : ""} href={mediaHref(kind, "", result.query)}>全部</Link>
            {videoCategories.map((category) => (
              <Link
                className={categoryParam === String(category.id) ? "isActive" : ""}
                href={mediaHref(kind, "", result.query, String(category.id))}
                key={category.id}
              >
                {category.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="mediaLibraryToolbar isSearchOnly">
          <form className="mediaSearchForm" action="/media">
            <Search size={16} aria-hidden="true" />
            <input
              name="q"
              defaultValue={result.query}
              placeholder={kind === "video" ? "搜索视频" : kind === "audio" ? "搜索标题、作者或目录" : "搜索文件或目录"}
              aria-label={kind === "video" ? "搜索视频" : kind === "audio" ? "搜索标题、作者或目录" : "搜索文件或目录"}
            />
            <input name="kind" type="hidden" value={kind} />
            {categoryParam ? <input name="category" type="hidden" value={categoryParam} /> : null}
            {kind !== "video" && result.folder ? <input name="folder" type="hidden" value={result.folder} /> : null}
            {result.query ? (
              <Link className="mediaSearchIconButton" href={mediaHref(kind, kind === "video" ? "" : result.folder, "", categoryParam)} aria-label="清除资源搜索" title="清除搜索">
                <X size={15} aria-hidden="true" />
              </Link>
            ) : null}
            <button className="mediaSearchIconButton" type="submit" aria-label="搜索资源" title="搜索资源">
              <Search size={15} aria-hidden="true" />
            </button>
          </form>
        </div>

        <div className="mediaExplorerContent">
            {kind !== "video" ? <nav className="mediaBreadcrumbs" aria-label="当前资源目录">
              <Link href={mediaHref(kind, "", result.query)}>根目录</Link>
              {segments.map((segment, index) => {
                const folder = segments.slice(0, index + 1).join("/");
                return (
                  <span key={folder}>
                    <ChevronRight size={13} aria-hidden="true" />
                    <Link href={mediaHref(kind, folder, result.query)}>{segment}</Link>
                  </span>
                );
              })}
            </nav> : null}

            {result.query ? (
              <p className="mediaSearchSummary">
                “{result.query}” · {kind === "video" ? `共 ${result.totalAssets} 项` : `当前目录及子目录共 ${result.totalAssets} 项`}
              </p>
            ) : null}

            {result.assets.length || childFolders.length ? (
              kind === "video" ? (
                <div className="mediaAssetGrid is-video">
                  {result.assets.map((asset) => <MediaVideoCard asset={asset} thumbnail={thumbnailSettings} key={asset.id} />)}
                </div>
              ) : (
                <div className="mediaResourceList">
                  {childFolders.map((folder) => (
                    <MediaFolderRow href={mediaHref(kind, folder.path)} name={folder.name} key={folder.path} />
                  ))}
                  {result.assets.map((asset) => <MediaResourceRow asset={asset} showFolder={Boolean(result.query)} key={asset.id} />)}
                </div>
              )
            ) : (
              <div className="mediaEmptyState">
                <EmptyIcon size={26} aria-hidden="true" />
                <p>{result.query ? "没有找到匹配的资源。" : kind === "video" ? "暂无视频。" : "当前文件夹暂无资源。"}</p>
              </div>
            )}

            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              query={result.query}
              basePath="/media"
              extraParams={{ kind, folder: kind === "video" ? undefined : result.folder || undefined, category: categoryParam || undefined }}
            />
        </div>
      </section>
    </main>
  );
}
