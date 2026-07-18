import { ChevronRight, Clapperboard, Disc3, File, Headphones, Search, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaFolderRow } from "@/components/MediaFolderRow";
import { MediaPublicSort } from "@/components/MediaPublicSort";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { getVideoThumbnailSettings } from "@/lib/config";
import {
  getAccessibleMediaKinds,
  isMediaKind,
  isMediaKindPublic,
  listMediaAssets,
  listMediaFolders,
  listVideoCategories,
  type MediaAsset,
  type MediaKind,
} from "@/lib/media";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";
import { formatMediaDuration } from "@/lib/media-metadata";
import { getCurrentUser } from "@/lib/user-auth";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";

export const dynamic = "force-dynamic";

type MediaPageProps = {
  searchParams: Promise<{ kind?: string; folder?: string; q?: string; page?: string; folderPage?: string; category?: string; sort?: string; order?: string }>;
};

const KIND_LABELS: Record<MediaKind, string> = { video: "视频", audio: "音频", file: "文件" };
const KIND_ICONS = { video: Clapperboard, audio: Headphones, file: File };

export async function generateMetadata({ searchParams }: MediaPageProps): Promise<Metadata> {
  const params = await searchParams;
  const publicKinds = getAccessibleMediaKinds(false);
  const requestedKind = isMediaKind(params.kind) ? params.kind : null;
  const kind = requestedKind || publicKinds[0];
  if (!kind) {
    return { title: "资源", robots: NO_INDEX_ROBOTS };
  }

  const isPublic = isMediaKindPublic(kind);
  const canonicalParams = new URLSearchParams({ kind });
  if (kind !== "video" && params.folder) canonicalParams.set("folder", params.folder);
  if (kind === "video" && /^\d+$/.test(params.category || "")) canonicalParams.set("category", params.category!);
  const page = Number(params.page || 1);
  if (Number.isInteger(page) && page > 1) canonicalParams.set("page", String(page));
  const folderPage = Number(params.folderPage || 1);
  if (Number.isInteger(folderPage) && folderPage > 1) canonicalParams.set("folderPage", String(folderPage));
  const canonical = `/media?${canonicalParams.toString()}`;
  const label = KIND_LABELS[kind];
  return {
    title: `${label}资源`,
    description: `浏览站内${label}资源。`,
    alternates: { canonical },
    robots: isPublic && !params.q?.trim() ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title: `${label}资源`, description: `浏览站内${label}资源。`, url: canonical },
  };
}

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

function mediaHref(
  kind: MediaKind,
  folder = "",
  query = "",
  category = "",
  sort: "name" | "size" = "name",
  order: "asc" | "desc" = "asc",
): string {
  const params = new URLSearchParams({ kind });
  if (folder) params.set("folder", folder);
  if (query) params.set("q", query);
  if (kind === "video" && category) params.set("category", category);
  if (sort === "size") params.set("sort", sort);
  if (order === "desc") params.set("order", order);
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
  const sortBy = params.sort === "size" ? "size" : "name";
  const sortOrder = params.order === "desc" ? "desc" : "asc";
  const videoCategories = kind === "video" ? listVideoCategories() : [];
  const requestedCategoryId = /^\d+$/.test(params.category || "") ? Number(params.category) : undefined;
  const videoCategoryId = requestedCategoryId && videoCategories.some((category) => category.id === requestedCategoryId)
    ? requestedCategoryId
    : undefined;
  const categoryParam = videoCategoryId ? String(videoCategoryId) : "";
  const activeVideoCategory = videoCategories.find((category) => category.id === videoCategoryId);
  const result = listMediaAssets({
    kind,
    videoCategoryId,
    folder: kind === "video" ? "" : params.folder,
    recursive: kind === "video",
    query: params.q,
    page: Number(params.page || 1),
    pageSize: 18,
    sortBy,
    sortOrder,
  });
  scheduleMediaPreparation(result.assets);
  const thumbnailSettings = getVideoThumbnailSettings();
  const folders = kind === "video" ? [] : listMediaFolders(kind);
  const EmptyIcon = KIND_ICONS[kind];
  const segments = result.folder ? result.folder.split("/") : [];
  const childFolders = result.query ? [] : folders.filter((folder) => folder.path.split("/").slice(0, -1).join("/") === result.folder);
  const folderPageSize = 36;
  const folderTotalPages = Math.max(1, Math.ceil(childFolders.length / folderPageSize));
  const folderPage = Math.min(Math.max(Math.floor(Number(params.folderPage || 1)), 1), folderTotalPages);
  const visibleChildFolders = childFolders.slice((folderPage - 1) * folderPageSize, folderPage * folderPageSize);
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: "首页", href: "/" },
    { label: KIND_LABELS[kind], href: segments.length || activeVideoCategory ? mediaHref(kind, "", "", "", sortBy, sortOrder) : undefined },
  ];
  if (activeVideoCategory) {
    breadcrumbItems.push({ label: activeVideoCategory.name });
  } else {
    segments.forEach((segment, index) => {
      const folder = segments.slice(0, index + 1).join("/");
      breadcrumbItems.push({ label: segment, href: index < segments.length - 1 ? mediaHref(kind, folder, result.query, "", sortBy, sortOrder) : undefined });
    });
  }

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={breadcrumbItems} />
      <section className="mediaLibrary">
        <header className="mediaLibraryHeader">
          <div className="mediaLibraryHeading">
            <span className="mediaLibraryTitleIcon" aria-hidden="true"><EmptyIcon size={23} /></span>
            <h1>{KIND_LABELS[kind]}</h1>
          </div>
          <div className="mediaLibraryActions">
            <MediaPublicSort
              kind={kind}
              folder={kind === "video" ? "" : result.folder}
              query={result.query}
              category={categoryParam}
              sortBy={sortBy}
              sortOrder={sortOrder}
            />
            <form className="mediaSearchForm" action="/media">
              <input
                name="q"
                defaultValue={result.query}
                placeholder={kind === "video" ? "搜索视频" : kind === "audio" ? "搜索标题、作者或目录" : "搜索文件或目录"}
                aria-label={kind === "video" ? "搜索视频" : kind === "audio" ? "搜索标题、作者或目录" : "搜索文件或目录"}
              />
              <input name="kind" type="hidden" value={kind} />
              {sortBy === "size" ? <input name="sort" type="hidden" value={sortBy} /> : null}
              {sortOrder === "desc" ? <input name="order" type="hidden" value={sortOrder} /> : null}
              {categoryParam ? <input name="category" type="hidden" value={categoryParam} /> : null}
              {kind !== "video" && result.folder ? <input name="folder" type="hidden" value={result.folder} /> : null}
              {result.query ? (
                <Link className="mediaSearchIconButton" href={mediaHref(kind, kind === "video" ? "" : result.folder, "", categoryParam, sortBy, sortOrder)} aria-label="清除资源搜索" title="清除搜索">
                  <X size={15} aria-hidden="true" />
                </Link>
              ) : null}
              <button className="mediaSearchIconButton" type="submit" aria-label="搜索资源" title="搜索资源">
                <Search size={16} aria-hidden="true" />
              </button>
            </form>
          </div>
        </header>

        {kind === "video" && videoCategories.length ? (
          <nav className="mediaVideoChannels" aria-label="视频分类">
            <Link className={!categoryParam ? "isActive" : ""} href={mediaHref(kind, "", result.query, "", sortBy, sortOrder)}>全部</Link>
            {videoCategories.map((category) => (
              <Link
                className={categoryParam === String(category.id) ? "isActive" : ""}
                href={mediaHref(kind, "", result.query, String(category.id), sortBy, sortOrder)}
                key={category.id}
              >
                {category.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="mediaExplorerContent">
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
                  {visibleChildFolders.map((folder) => (
                    <MediaFolderRow href={mediaHref(kind, folder.path, "", "", sortBy, sortOrder)} name={folder.name} key={folder.path} />
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
              extraParams={{
                kind,
                folder: kind === "video" ? undefined : result.folder || undefined,
                category: categoryParam || undefined,
                folderPage: folderPage > 1 ? String(folderPage) : undefined,
                sort: sortBy === "size" ? sortBy : undefined,
                order: sortOrder === "desc" ? sortOrder : undefined,
              }}
            />
            <Pagination
              page={folderPage}
              totalPages={folderTotalPages}
              query={result.query}
              basePath="/media"
              pageParam="folderPage"
              extraParams={{
                kind,
                folder: kind === "video" ? undefined : result.folder || undefined,
                category: categoryParam || undefined,
                page: result.page > 1 ? String(result.page) : undefined,
                sort: sortBy === "size" ? sortBy : undefined,
                order: sortOrder === "desc" ? sortOrder : undefined,
              }}
            />
        </div>
      </section>
    </main>
  );
}
