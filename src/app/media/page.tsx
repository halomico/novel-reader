import { ChevronRight, Clapperboard, Disc3, File, Headphones, Search, X } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "@/components/LocalizedLink";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MediaFolderRow } from "@/components/MediaFolderRow";
import { MediaConnectionHint } from "@/components/MediaConnectionHint";
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
  normalizeMediaFolder,
  sortMediaFolders,
  type MediaAsset,
  type MediaKind,
  type MediaSortBy,
  type MediaSortOrder,
} from "@/lib/media";
import { formatMediaDuration } from "@/lib/media-format";
import { getMediaPublicUrlForKind } from "@/lib/media-storage-config";
import { getCurrentUser } from "@/lib/user-auth";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { directMediaThumbnailUrl } from "@/lib/media-thumbnail-url";
import { getRequestLocale, localizeText, normalizeSearchText } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath, type AppLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

type MediaPageProps = {
  searchParams: Promise<{ kind?: string; folder?: string; q?: string; page?: string; folderPage?: string; category?: string; sort?: string; order?: string }>;
};

const KIND_LABELS: Record<MediaKind, string> = { video: "视频", audio: "音频", file: "文件" };
const KIND_ICONS = { video: Clapperboard, audio: Headphones, file: File };

export async function generateMetadata({ searchParams }: MediaPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const publicKinds = getAccessibleMediaKinds(false);
  const requestedKind = isMediaKind(params.kind) ? params.kind : null;
  const kind = requestedKind || publicKinds[0];
  if (!kind) {
    return { title: uiText(locale, "资源"), robots: NO_INDEX_ROBOTS };
  }

  const isPublic = isMediaKindPublic(kind);
  const canonicalParams = new URLSearchParams({ kind });
  if (kind !== "video" && params.folder) canonicalParams.set("folder", params.folder);
  if (kind === "video" && /^\d+$/.test(params.category || "")) canonicalParams.set("category", params.category!);
  const page = Number(params.page || 1);
  if (Number.isInteger(page) && page > 1) canonicalParams.set("page", String(page));
  const folderPage = Number(params.folderPage || 1);
  if (Number.isInteger(folderPage) && folderPage > 1) canonicalParams.set("folderPage", String(folderPage));
  const canonicalPath = `/media?${canonicalParams.toString()}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const label = uiText(locale, KIND_LABELS[kind]);
  const title = `${label}${uiText(locale, "资源")}`;
  const description = locale === "zh-Hant" ? `瀏覽站內${label}資源。` : `浏览站内${label}资源。`;
  return {
    title,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    robots: isPublic && !params.q?.trim() ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title, description, url: canonical },
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
  sort?: MediaSortBy,
  order?: MediaSortOrder,
): string {
  const defaultSort: MediaSortBy = kind === "audio" && !folder ? "duration" : "name";
  const selectedSort = sort || defaultSort;
  const selectedOrder = order || (selectedSort === "name" ? "asc" : "desc");
  const params = new URLSearchParams({ kind });
  if (folder) params.set("folder", folder);
  if (query) params.set("q", query);
  if (kind === "video" && category) params.set("category", category);
  if (selectedSort !== defaultSort) params.set("sort", selectedSort);
  if (selectedOrder !== (selectedSort === "name" ? "asc" : "desc")) params.set("order", selectedOrder);
  return `/media?${params.toString()}`;
}

function MediaResourceRow({
  asset,
  showFolder,
  locale,
}: {
  asset: MediaAsset;
  showFolder: boolean;
  locale: AppLocale;
}) {
  const title = displayTitle(asset.title, asset.fileName);
  const Icon = asset.kind === "audio" ? Disc3 : File;
  const metadata = [
    asset.kind === "audio" ? asset.artist || uiText(locale, "未知作者") : asset.description || uiText(locale, "文件"),
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
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const headerStore = await headers();
  const accessibleKinds = getAccessibleMediaKinds(Boolean(user)).filter((candidate) => checkContentAccess(headerStore, {
    scope: candidate,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  }).allowed);
  if (!accessibleKinds.length) notFound();
  const params = await searchParams;
  const requestedKind = isMediaKind(params.kind) ? params.kind : null;
  if (requestedKind && !accessibleKinds.includes(requestedKind)) notFound();
  const kind = requestedKind || accessibleKinds[0];
  const mediaPublicOrigin = getMediaPublicUrlForKind(kind);
  const requestedFolder = kind === "video" ? "" : normalizeMediaFolder(params.folder || "") || "";
  const timedKind = kind === "video" || kind === "audio";
  const defaultSortBy: MediaSortBy = kind === "audio" && !requestedFolder ? "duration" : "name";
  const sortBy: MediaSortBy = timedKind
    ? params.sort === "duration" ? "duration" : params.sort === "name" ? "name" : defaultSortBy
    : params.sort === "size" ? "size" : "name";
  const sortOrder: MediaSortOrder = params.order === "asc" || params.order === "desc"
    ? params.order
    : sortBy === "name" ? "asc" : "desc";
  const videoCategories = kind === "video" ? listVideoCategories() : [];
  const requestedCategoryId = /^\d+$/.test(params.category || "") ? Number(params.category) : undefined;
  const videoCategoryId = requestedCategoryId && videoCategories.some((category) => category.id === requestedCategoryId)
    ? requestedCategoryId
    : undefined;
  const categoryParam = videoCategoryId ? String(videoCategoryId) : "";
  const activeVideoCategory = videoCategories.find((category) => category.id === videoCategoryId);
  const queryInput = (params.q || "").trim();
  const sourceResult = listMediaAssets({
    kind,
    videoCategoryId,
    folder: requestedFolder,
    recursive: kind === "video",
    query: queryInput ? await normalizeSearchText(queryInput) : "",
    page: Number(params.page || 1),
    pageSize: kind === "video" ? 30 : kind === "audio" ? 50 : 18,
    sortBy,
    sortOrder,
  });
  const result = { ...sourceResult, query: queryInput };
  const displayAssets = await Promise.all(result.assets.map(async (asset) => ({
    ...asset,
    title: await localizeText(asset.title, locale),
    description: await localizeText(asset.description, locale),
    artist: asset.artist ? await localizeText(asset.artist, locale) : asset.artist,
  })));
  const displayCategories = await Promise.all(videoCategories.map(async (category) => ({
    ...category,
    name: await localizeText(category.name, locale),
  })));
  const displayCategory = activeVideoCategory
    ? displayCategories.find((category) => category.id === activeVideoCategory.id)
    : undefined;
  const thumbnailSettings = getVideoThumbnailSettings();
  const directThumbnails = kind === "video" && !hasScopedContentAccessRules("video");
  const publiclyAccessibleThumbnails = directThumbnails && isMediaKindPublic("video");
  const folders = kind === "video" ? [] : listMediaFolders(kind);
  const EmptyIcon = KIND_ICONS[kind];
  const segments = result.folder ? result.folder.split("/") : [];
  const normalizedFolderTerms = sourceResult.query.normalize("NFKC").toLocaleLowerCase().split(" ").filter(Boolean);
  const folderSearchPrefix = result.folder ? `${result.folder}/` : "";
  const childFolders = sortMediaFolders(
    folders.filter((folder) => {
      if (result.query) {
        return folder.path.startsWith(folderSearchPrefix) &&
          normalizedFolderTerms.every((term) => folder.path.normalize("NFKC").toLocaleLowerCase().includes(term));
      }
      return folder.path.split("/").slice(0, -1).join("/") === result.folder;
    }),
    sortBy,
    sortOrder,
  );
  const folderPageSize = 36;
  const folderTotalPages = Math.max(1, Math.ceil(childFolders.length / folderPageSize));
  const folderPage = Math.min(Math.max(Math.floor(Number(params.folderPage || 1)), 1), folderTotalPages);
  const visibleChildFolders = childFolders.slice((folderPage - 1) * folderPageSize, folderPage * folderPageSize);
  const displayFolderNames = new Map(
    await Promise.all(visibleChildFolders.map(async (folder) => [
      folder.path,
      await localizeText(result.query ? folder.path : folder.name, locale),
    ] as const)),
  );
  const displaySegments = await Promise.all(segments.map((segment) => localizeText(segment, locale)));
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: uiText(locale, "首页"), href: "/" },
    { label: uiText(locale, KIND_LABELS[kind]), href: segments.length || activeVideoCategory ? mediaHref(kind) : undefined },
  ];
  if (displayCategory) {
    breadcrumbItems.push({ label: displayCategory.name });
  } else {
    segments.forEach((segment, index) => {
      const folder = segments.slice(0, index + 1).join("/");
      breadcrumbItems.push({
        label: displaySegments[index],
        href: index < segments.length - 1 ? mediaHref(kind, folder, result.query, "", sortBy, sortOrder) : undefined,
      });
    });
  }
  const searchPlaceholder = kind === "video"
    ? uiText(locale, "搜索视频")
    : kind === "audio"
      ? uiText(locale, "搜索标题、作者或目录")
      : uiText(locale, "搜索文件或目录");

  return (
    <>
      <MediaConnectionHint origin={mediaPublicOrigin} />
      <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={breadcrumbItems} />
      <section className="mediaLibrary">
        <header className="mediaLibraryHeader">
          <div className="mediaLibraryHeading">
            <span className="mediaLibraryTitleIcon" aria-hidden="true"><EmptyIcon size={23} /></span>
            <h1>{uiText(locale, KIND_LABELS[kind])}</h1>
          </div>
          <div className="mediaLibraryActions">
            <MediaPublicSort
              kind={kind}
              folder={kind === "video" ? "" : result.folder}
              query={result.query}
              category={categoryParam}
              sortBy={sortBy}
              sortOrder={sortOrder}
              locale={locale}
            />
            <Form className="mediaSearchForm" action="/media">
              <input
                name="q"
                defaultValue={result.query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
              <input name="kind" type="hidden" value={kind} />
              {sortBy !== defaultSortBy ? <input name="sort" type="hidden" value={sortBy} /> : null}
              {sortOrder !== (sortBy === "name" ? "asc" : "desc") ? <input name="order" type="hidden" value={sortOrder} /> : null}
              {categoryParam ? <input name="category" type="hidden" value={categoryParam} /> : null}
              {kind !== "video" && result.folder ? <input name="folder" type="hidden" value={result.folder} /> : null}
              {result.query ? (
                <Link className="mediaSearchIconButton" href={mediaHref(kind, kind === "video" ? "" : result.folder, "", categoryParam, sortBy, sortOrder)} aria-label={uiText(locale, "清除资源搜索")} title={uiText(locale, "清除搜索")}>
                  <X size={15} aria-hidden="true" />
                </Link>
              ) : null}
              <button className="mediaSearchIconButton" type="submit" aria-label={uiText(locale, "搜索资源")} title={uiText(locale, "搜索资源")}>
                <Search size={16} aria-hidden="true" />
              </button>
            </Form>
          </div>
        </header>

        {kind === "video" && videoCategories.length ? (
          <nav className="mediaVideoChannels" aria-label={uiText(locale, "视频分类")}>
            <Link className={!categoryParam ? "isActive" : ""} href={mediaHref(kind, "", result.query, "", sortBy, sortOrder)}>{uiText(locale, "全部")}</Link>
            {displayCategories.map((category) => (
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
                “{result.query}” · {kind === "video"
                  ? `${uiText(locale, "共")} ${result.totalAssets} ${uiText(locale, "项")}`
                  : `${uiText(locale, "共")} ${childFolders.length} ${uiText(locale, "个文件夹")}、${result.totalAssets} ${uiText(locale, "项资源")}`}
              </p>
            ) : null}

            {result.assets.length || childFolders.length ? (
              kind === "video" ? (
                <div className="mediaAssetGrid is-video">
                {displayAssets.map((asset, index) => (
                    <MediaVideoCard
                      asset={asset}
                      thumbnail={thumbnailSettings}
                      thumbnailUrl={directThumbnails
                        ? directMediaThumbnailUrl(asset, thumbnailSettings.singlePercent, publiclyAccessibleThumbnails)
                        : null}
                      priority={index < 8}
                      key={asset.id}
                    />
                  ))}
                </div>
              ) : (
                <div className="mediaResourceList">
                  {visibleChildFolders.map((folder) => (
                    <MediaFolderRow
                      href={kind === "audio"
                        ? mediaHref(kind, folder.path)
                        : mediaHref(kind, folder.path, "", "", sortBy, sortOrder)}
                      name={displayFolderNames.get(folder.path) || folder.name}
                      sizeLabel={kind === "audio" ? `${folder.totalAssets} ${uiText(locale, "项")}` : formatBytes(folder.totalSizeBytes)}
                      locale={locale}
                      key={folder.path}
                    />
                  ))}
                  {displayAssets.map((asset) => <MediaResourceRow asset={asset} showFolder={Boolean(result.query)} locale={locale} key={asset.id} />)}
                </div>
              )
            ) : (
              <div className="mediaEmptyState">
                <EmptyIcon size={26} aria-hidden="true" />
                <p>{uiText(locale, result.query ? "没有找到匹配的资源。" : kind === "video" ? "暂无视频。" : "当前文件夹暂无资源。")}</p>
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
                sort: sortBy === defaultSortBy ? undefined : sortBy,
                order: sortOrder === (sortBy === "name" ? "asc" : "desc") ? undefined : sortOrder,
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
                sort: sortBy === defaultSortBy ? undefined : sortBy,
                order: sortOrder === (sortBy === "name" ? "asc" : "desc") ? undefined : sortOrder,
              }}
            />
        </div>
      </section>
      </main>
    </>
  );
}
