import {
  Activity,
  Bean,
  BookOpen,
  Disc3,
  Film,
  FileText,
  Headphones,
  Heart,
  History,
  LayoutGrid,
  Sprout,
  TreeDeciduous,
  Trees,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CatalogBookCard, formatNovelWordCount } from "@/components/CatalogBookGrid";
import {
  FavoriteSelectableItem,
  FavoriteSelectionManager,
} from "@/components/FavoriteSelectionManager";
import Link from "@/components/LocalizedLink";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { OriginalArticleRows } from "@/components/OriginalArticleRows";
import { Pagination } from "@/components/Pagination";
import { ReadingHistoryList } from "@/components/ReadingHistoryList";
import { ResultCount } from "@/components/ResultCount";
import { WorkspacePage, WorkspacePageHeader, WorkspacePrimaryTabs, WorkspaceSegmentedTabs } from "@/components/WorkspacePageChrome";
import { database } from "@/core/db/postgres";
import {
  checkPostgresContentAccess,
  hasPostgresScopedContentAccessRules,
} from "@/domains/access/postgres-content-access";
import { listPostgresFavoriteMedia, listPostgresFavoriteOriginals } from "@/domains/activity/postgres-favorites";
import {
  listPostgresGrovePage,
  normalizePostgresGroveStage,
  type PostgresGroveItem as GroveItem,
  type PostgresGroveKind as GroveKind,
  type PostgresGroveStage as GroveStage,
} from "@/domains/activity/postgres-grove";
import { listPostgresNovelFavoritesPage } from "@/domains/reading/postgres-reader-interactions";
import { listPostgresReadingProgressPage } from "@/domains/reading/postgres-reading-progress";
import { listPostgresOriginalReadingHistory } from "@/domains/originals/postgres-reading";
import { canAccessOriginalChannel, canConsumeOriginalChannel, getVideoThumbnailSettings } from "@/lib/config";
import { formatLocalDateTime, formatRelativeUpdateTime, parseAppDateTime, toDateTimeAttribute } from "@/lib/date-time";
import { isMediaKindPublic } from "@/domains/media/media-model";
import { formatMediaDuration } from "@/lib/media-format";
import { directMediaThumbnailUrl } from "@/lib/media-thumbnail-url";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";
const ACTIVITY_PAGE_SIZE = 50;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: uiText(locale, "动态"), robots: NO_INDEX_ROBOTS };
}

function displayMediaTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase())
    ? title.slice(0, -extension.length)
    : title;
}

const GROVE_STAGE_LABELS: Record<GroveStage, string> = {
  seed: "种子",
  sprout: "幼苗",
  tree: "大树",
};

const GROVE_STAGE_ICONS = {
  seed: Bean,
  sprout: Sprout,
  tree: TreeDeciduous,
} as const;

function groveFilterHref(stage: GroveStage | null): string {
  return stage ? `/activity?view=grove&stage=${stage}` : "/activity?view=grove";
}

function formatGroveRelativeTime(
  value: string,
  locale: Awaited<ReturnType<typeof getRequestLocale>>,
  now = Date.now(),
): string {
  const timestamp = parseAppDateTime(value)?.getTime();
  if (!timestamp) return "";
  return formatRelativeUpdateTime(timestamp, {
    justNow: uiText(locale, "刚刚"),
    minutesAgo: uiText(locale, "分钟前"),
    hoursAgo: uiText(locale, "小时前"),
    daysAgo: uiText(locale, "天前"),
  }, now);
}

function GroveCard({ item, locale, returnHref, resume }: {
  item: GroveItem;
  locale: Awaited<ReturnType<typeof getRequestLocale>>;
  returnHref: string;
  resume: boolean;
}) {
  const Icon = item.kind === "novel" ? BookOpen : item.kind === "original" ? FileText : item.kind === "video" ? Film : Headphones;
  const StageIcon = GROVE_STAGE_ICONS[item.stage];
  const typeLabel = uiText(locale, item.kind === "novel" ? "小说" : item.kind === "original" ? "原创" : item.kind === "video" ? "视频" : "音频");
  const title = item.kind === "novel" || item.kind === "original" ? item.title : displayMediaTitle(item.title, item.fileName);
  const metadata = item.kind === "novel"
    ? [formatNovelWordCount(item.wordCount, locale), item.chapterCount ? `${item.chapterCount}${uiText(locale, "章")}` : ""].filter(Boolean).join(" · ")
    : item.kind === "original"
      ? [item.authorName, formatNovelWordCount(item.wordCount, locale), item.unlockSodaPrice > 0 ? `${item.unlockSodaPrice} ${uiText(locale, "苏打")}` : ""].filter(Boolean).join(" · ")
    : item.kind === "audio"
      ? [item.artist, formatMediaDuration(item.durationSeconds)].filter(Boolean).join(" · ")
      : formatMediaDuration(item.durationSeconds);
  const contentHref = item.kind === "novel"
    ? (() => {
        const path = item.storageMode === "chapters" ? `/books/${item.id}/chapters` : `/books/${item.id}`;
        const query = new URLSearchParams({ from: returnHref });
        if (resume) query.set("resume", "1");
        return `${path}?${query.toString()}`;
      })()
    : item.kind === "original"
      ? `/original/${item.slug}${resume ? "?resume=1" : ""}`
      : `/media/${item.id}${item.kind === "video" ? "#watch" : ""}`;
  const plantedTime = formatGroveRelativeTime(item.plantedAt, locale);

  return (
    <Link className={`groveCard is-${item.kind} is-${item.stage}`} href={contentHref}>
      <span className="groveCardBody">
        <span className="groveCardTitleLine">
          <strong title={title}>{title}</strong>
          <span className={`groveStageBadge is-${item.stage}`}>
            <StageIcon size={12} aria-hidden="true" />
            <span>{uiText(locale, GROVE_STAGE_LABELS[item.stage])}</span>
          </span>
        </span>
        <span className="groveCardBottomLine">
          <span className="groveCardFacts">
            {metadata ? <span className="groveCardMeta">{metadata}</span> : null}
            <span className="groveVisitCount">{uiText(locale, "访问")} {item.visitCount} {uiText(locale, "次")}</span>
          </span>
          {plantedTime ? (
            <time
              className="grovePlantedTime"
              dateTime={toDateTimeAttribute(item.plantedAt)}
              title={formatLocalDateTime(item.plantedAt)}
            >
              <span
                className={`groveTimeTypeIcon is-${item.kind}`}
                aria-label={typeLabel}
                title={typeLabel}
              >
                <Icon size={12} aria-hidden="true" />
              </span>
              {plantedTime}
            </time>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; stage?: string; type?: string; view?: string }>;
}) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!user) redirect(withLocalePath("/login?returnTo=/activity", locale));
  const params = await searchParams;
  const view = params.view === "favorites" ? "favorites" : params.view === "grove" ? "grove" : "recent";
  const groveStage = normalizePostgresGroveStage(params.stage);
  const recentKind = params.type === "original" ? "original" : "novel";
  const activeReadingHistoryEnabled = recentKind === "original"
    ? user.originalReadingHistoryEnabled
    : user.readingHistoryEnabled;
  const favoriteKind = params.type === "original" ? "original" : params.type === "videos" ? "video" : params.type === "audio" ? "audio" : "novel";
  const mediaKind = favoriteKind === "video" || favoriteKind === "audio" ? favoriteKind : null;
  const requestHeaders = await headers();
  const scopedGroveKinds: GroveKind[] = view === "grove"
    ? (await Promise.all((["novel", "video", "audio"] as const).map(async (scope) => ({
        scope,
        allowed: (await checkPostgresContentAccess(database("web"), requestHeaders, {
          scope,
          authenticated: true,
          admin: user.role === "admin",
          rateLimit: false,
        })).allowed,
      })))).filter((item) => item.allowed).map((item) => item.scope)
    : [];
  const allowedGroveKinds: GroveKind[] = canConsumeOriginalChannel(true)
    ? scopedGroveKinds.includes("novel")
      ? ["novel", "original", ...scopedGroveKinds.filter((kind) => kind !== "novel")]
      : ["original", ...scopedGroveKinds]
    : scopedGroveKinds;
  if (view === "grove") {
    if (!allowedGroveKinds.length) notFound();
  } else {
    const originalSelected = (view === "recent" && recentKind === "original") ||
      (view === "favorites" && favoriteKind === "original");
    if (originalSelected) {
      if (!canAccessOriginalChannel(true)) notFound();
    } else {
      const access = await checkPostgresContentAccess(database("web"), requestHeaders, {
        scope: mediaKind || "novel",
        authenticated: true,
        admin: user.role === "admin",
        rateLimit: false,
      });
      if (!access.allowed) notFound();
    }
  }
  const recent = view === "recent" && recentKind === "novel"
    ? activeReadingHistoryEnabled
      ? await listPostgresReadingProgressPage(database("web"), user.id, {
          page: Number(params.page || 1),
          pageSize: ACTIVITY_PAGE_SIZE,
        })
      : {
          items: [],
          page: 1,
          pageSize: ACTIVITY_PAGE_SIZE,
          totalItems: 0,
          totalPages: 1,
        }
    : null;
  const originalRecent = view === "recent" && recentKind === "original"
    ? activeReadingHistoryEnabled
      ? await listPostgresOriginalReadingHistory(database("web"), user.id, { page: Number(params.page || 1), pageSize: ACTIVITY_PAGE_SIZE })
      : { items: [], page: 1, pageSize: ACTIVITY_PAGE_SIZE, totalItems: 0, totalPages: 1 }
    : null;
  const novelResult = view === "favorites" && favoriteKind === "novel"
    ? await listPostgresNovelFavoritesPage(database("web"), user.id, {
        page: Number(params.page || 1),
        pageSize: ACTIVITY_PAGE_SIZE,
      })
    : null;
  const originalResult = view === "favorites" && favoriteKind === "original"
    ? await listPostgresFavoriteOriginals(database("web"), user.id, {
        page: Number(params.page || 1),
        pageSize: ACTIVITY_PAGE_SIZE,
      })
    : null;
  const mediaResult = view === "favorites" && mediaKind
    ? await listPostgresFavoriteMedia(database("web"), user.id, mediaKind, {
        page: Number(params.page || 1),
        pageSize: ACTIVITY_PAGE_SIZE,
      })
    : null;
  const groveResult = view === "grove"
    ? await listPostgresGrovePage(database("web"), user.id, {
        stage: groveStage,
        allowedKinds: allowedGroveKinds,
        page: Number(params.page || 1),
        pageSize: ACTIVITY_PAGE_SIZE,
      })
    : null;
  const displayRecent = recent
    ? {
        ...recent,
        items: await Promise.all(recent.items.map(async (item) => ({
          ...item,
          title: await localizeText(item.title, locale),
        }))),
      }
    : null;
  const displayOriginalRecent = originalRecent
    ? {
        ...originalRecent,
        items: await Promise.all(originalRecent.items.map(async (item) => ({
          ...item,
          title: await localizeText(item.title, locale),
          authorName: await localizeText(item.authorName, locale),
        }))),
      }
    : null;
  const displayNovelResult = novelResult
    ? {
        ...novelResult,
        items: await Promise.all(novelResult.items.map(async (book) => ({
          id: book.id,
          title: await localizeText(book.title, locale),
          storage_mode: book.storageMode,
          chapter_count: book.chapterCount,
          soda_price: book.sodaPrice,
          word_count: book.wordCount,
          mtime_ms: book.mtimeMs,
          updated_at: book.updatedAt,
        }))),
      }
    : null;
  const displayOriginalResult = originalResult
    ? {
        ...originalResult,
        totalArticles: originalResult.totalItems,
        articles: await Promise.all(originalResult.items.map(async (article) => ({
          ...article,
          title: await localizeText(article.title, locale),
          authorName: await localizeText(article.authorName, locale),
        }))),
      }
    : null;
  const displayMediaResult = mediaResult
    ? {
        ...mediaResult,
        totalAssets: mediaResult.totalItems,
        assets: await Promise.all(mediaResult.items.map(async (asset) => ({
          ...asset,
          title: await localizeText(asset.title, locale),
          artist: asset.artist ? await localizeText(asset.artist, locale) : asset.artist,
        }))),
      }
    : null;
  const displayGroveResult = groveResult
    ? {
        ...groveResult,
        items: await Promise.all(groveResult.items.map(async (item) => ({
          ...item,
          title: await localizeText(item.title, locale),
          ...((item.kind === "video" || item.kind === "audio") && item.artist
            ? { artist: await localizeText(item.artist, locale) }
            : {}),
          ...(item.kind === "original"
            ? { authorName: await localizeText(item.authorName, locale) }
            : {}),
        }))),
      }
    : null;
  const readingPage = recentKind === "original" ? displayOriginalRecent : displayRecent;
  const readingItems = recentKind === "original"
    ? (displayOriginalRecent?.items || []).map((item) => ({
        id: item.articleId,
        title: item.title,
        href: `/original/${item.slug}?resume=1`,
        progressPercent: item.progressPercent,
        completed: item.completed,
        lastReadAt: item.lastReadAt,
        author: {
          id: item.authorId,
          name: item.authorName,
          avatarPath: item.authorAvatarPath,
        },
      }))
    : (displayRecent?.items || []).map((item) => ({
        id: item.novelId,
        title: item.title,
        href: item.chapterId
          ? `/books/${item.novelId}/chapters/${item.chapterId}?resume=1`
          : `/books/${item.novelId}?resume=1`,
        progressPercent: item.progressPercent,
        completed: item.completed,
        lastReadAt: item.lastReadAt,
      }));
  const thumbnailSettings = getVideoThumbnailSettings();
  const directThumbnails = mediaKind === "video" && !await hasPostgresScopedContentAccessRules(database("web"), "video");
  const publiclyAccessibleThumbnails = directThumbnails && isMediaKindPublic("video");
  const total = recent?.totalItems ?? originalRecent?.totalItems ?? groveResult?.totalItems ?? mediaResult?.totalItems ?? originalResult?.totalItems ?? novelResult?.totalItems ?? 0;
  const [
    activityLabel,
    recentLabel,
    favoritesLabel,
    groveLabel,
    personalContentLabel,
    favoriteTypeLabel,
    novelsLabel,
    originalLabel,
    videosLabel,
    audioLabel,
  ] = await localizeTexts(
    ["动态", "最近", "收藏", "回响林", "个人内容", "收藏类型", "小说", "原创", "视频", "音频"] as const,
    locale,
  );

  return (
    <>
      <WorkspacePage className="activityLibrary">
        <WorkspacePageHeader
          icon={Activity}
          title={activityLabel}
          trailing={view === "recent" && !activeReadingHistoryEnabled
            ? undefined
            : <ResultCount
                count={total}
                unit={view === "grove"
                  ? uiText(locale, "项")
                  : (view === "recent" && recentKind === "original") || (view === "favorites" && favoriteKind === "original")
                    ? uiText(locale, "篇")
                    : undefined}
              />}
        />
        <WorkspacePrimaryTabs
          className="activityTabs"
          label={personalContentLabel}
          items={[
            { href: "/activity", label: recentLabel, icon: History, active: view === "recent" },
            { href: "/activity?view=favorites", label: favoritesLabel, icon: Heart, active: view === "favorites" },
            { href: "/activity?view=grove", label: groveLabel, icon: Trees, active: view === "grove" },
          ]}
        />

        {readingPage ? (
          <>
            <WorkspaceSegmentedTabs
              className="activityContentTypeTabs"
              label={uiText(locale, "阅读类型")}
              items={[
                { href: "/activity", label: novelsLabel, icon: BookOpen, active: recentKind === "novel" },
                { href: "/activity?type=original", label: originalLabel, icon: FileText, active: recentKind === "original" },
              ]}
            />
            <ReadingHistoryList
              initialItems={readingItems}
              page={readingPage.page}
              totalPages={readingPage.totalPages}
              locale={locale}
              historyEnabled={activeReadingHistoryEnabled}
              kind={recentKind}
            />
          </>
        ) : displayGroveResult ? (
          <>
            <section className="groveOverview" aria-labelledby="grove-title">
              <header className="groveIntro">
                <Trees className="groveIntroIcon" size={36} strokeWidth={1.65} aria-hidden="true" />
                <div className="groveIntroCopy">
                  <h2 id="grove-title">{groveLabel}</h2>
                  <p>{uiText(locale, "把值得反复浏览的内容种进来，访问越多，它生长得越茂盛。")}</p>
                </div>
              </header>
              <dl className="groveStats">
                {([
                  ["all", "林内总数", displayGroveResult.stats.all, LayoutGrid],
                  ["seed", "种子", displayGroveResult.stats.seed, Bean],
                  ["sprout", "幼苗", displayGroveResult.stats.sprout, Sprout],
                  ["tree", "大树", displayGroveResult.stats.tree, TreeDeciduous],
                ] as const).map(([stage, label, count, StageIcon]) => (
                  <div className={`groveStatCard is-${stage}`} key={stage}>
                    <dt>
                      <span className="groveStatIcon"><StageIcon size={16} aria-hidden="true" /></span>
                      <span>{uiText(locale, label)}</span>
                    </dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <nav className="groveStageTabs" aria-label={uiText(locale, "回响林成长阶段")}>
              {([
                [null, "全部", displayGroveResult.stats.all, LayoutGrid],
                ["seed", "种子", displayGroveResult.stats.seed, Bean],
                ["sprout", "幼苗", displayGroveResult.stats.sprout, Sprout],
                ["tree", "大树", displayGroveResult.stats.tree, TreeDeciduous],
              ] as const).map(([stage, label, count, StageIcon]) => (
                <Link
                  className={`is-${stage || "all"}${groveStage === stage ? " isActive" : ""}`}
                  href={groveFilterHref(stage)}
                  aria-current={groveStage === stage ? "page" : undefined}
                  key={stage || "all"}
                >
                  <StageIcon size={15} aria-hidden="true" />
                  <span>{uiText(locale, label)}</span>
                  <small>({count})</small>
                </Link>
              ))}
            </nav>
            {displayGroveResult.items.length ? (
              <section className="groveGrid" aria-label={groveLabel}>
                {displayGroveResult.items.map((item) => (
                  <GroveCard
                    item={item}
                    locale={locale}
                    returnHref={groveFilterHref(groveStage)}
                    resume={item.kind === "original"
                      ? user.originalReadingHistoryEnabled
                      : item.kind === "novel" && user.readingHistoryEnabled}
                    key={`${item.kind}-${item.id}`}
                  />
                ))}
              </section>
            ) : (
              <div className="groveEmpty">
                <Sprout size={26} aria-hidden="true" />
                <strong>{groveStage
                  ? `${uiText(locale, "还没有")}${uiText(locale, GROVE_STAGE_LABELS[groveStage])}`
                  : uiText(locale, "回响林还是空的")}</strong>
                {!groveStage ? <span>{uiText(locale, "在内容页点击幼苗图标，即可种下一颗种子")}</span> : null}
              </div>
            )}
            <Pagination
              page={displayGroveResult.page}
              totalPages={displayGroveResult.totalPages}
              query=""
              basePath="/activity"
              extraParams={{ view: "grove", stage: groveStage || undefined }}
            />
          </>
        ) : (
          <>
            <WorkspaceSegmentedTabs
              className="favoriteTabs"
              label={favoriteTypeLabel}
              items={[
                { href: "/activity?view=favorites", label: novelsLabel, icon: BookOpen, active: favoriteKind === "novel" },
                { href: "/activity?view=favorites&type=original", label: originalLabel, icon: FileText, active: favoriteKind === "original" },
                { href: "/activity?view=favorites&type=videos", label: videosLabel, icon: Film, active: favoriteKind === "video" },
                { href: "/activity?view=favorites&type=audio", label: audioLabel, icon: Headphones, active: favoriteKind === "audio" },
              ]}
            />
            {displayNovelResult?.items.length ? (
              <FavoriteSelectionManager
                kind="novel"
                visibleIds={displayNovelResult.items.map((book) => book.id)}
                locale={locale}
              >
                <section className="bookGrid favoriteBookGrid" aria-label={uiText(locale, "收藏小说")}>
                  {displayNovelResult.items.map((book) => (
                    <FavoriteSelectableItem id={book.id} label={book.title} key={book.id}>
                      <CatalogBookCard
                        book={book}
                        returnHref={`/activity?view=favorites&page=${displayNovelResult.page}`}
                        resume={user.readingHistoryEnabled}
                        locale={locale}
                      />
                    </FavoriteSelectableItem>
                  ))}
                </section>
              </FavoriteSelectionManager>
            ) : displayOriginalResult?.articles.length ? (
              <FavoriteSelectionManager
                kind="original"
                visibleIds={displayOriginalResult.articles.map((article) => article.id)}
                locale={locale}
              >
                <OriginalArticleRows
                  items={displayOriginalResult.articles}
                  locale={locale}
                  selectable
                  resume={user.originalReadingHistoryEnabled}
                />
              </FavoriteSelectionManager>
            ) : mediaKind === "video" && displayMediaResult?.assets.length ? (
              <FavoriteSelectionManager
                kind="video"
                visibleIds={displayMediaResult.assets.map((asset) => asset.id)}
                locale={locale}
              >
                <div className="mediaAssetGrid is-video favoriteVideoGrid">
                  {displayMediaResult.assets.map((asset, index) => (
                    <FavoriteSelectableItem id={asset.id} label={asset.title} key={asset.id}>
                      <MediaVideoCard
                        asset={asset}
                        thumbnail={thumbnailSettings}
                        thumbnailUrl={directThumbnails
                          ? directMediaThumbnailUrl(asset, thumbnailSettings.singlePercent, publiclyAccessibleThumbnails)
                          : null}
                        priority={index === 0}
                        eager={index < 6}
                        locale={locale}
                      />
                    </FavoriteSelectableItem>
                  ))}
                </div>
              </FavoriteSelectionManager>
            ) : mediaKind === "audio" && displayMediaResult?.assets.length ? (
              <FavoriteSelectionManager
                kind="audio"
                visibleIds={displayMediaResult.assets.map((asset) => asset.id)}
                locale={locale}
              >
                <div className="mediaResourceList favoriteAudioList">
                  {displayMediaResult.assets.map((asset) => {
                    const title = displayMediaTitle(asset.title, asset.fileName);
                    return (
                      <FavoriteSelectableItem id={asset.id} label={title} key={asset.id}>
                        <Link className="mediaResourceRow" href={`/media/${asset.id}`}>
                          <span className="mediaAssetIcon is-audio" aria-hidden="true"><Disc3 size={21} /></span>
                          <span className="mediaCardCopy">
                            <strong title={title}>{title}</strong>
                            <small>{asset.artist || uiText(locale, "未知作者")}</small>
                          </span>
                          <span className="mediaCardSize">{formatMediaDuration(asset.durationSeconds)}</span>
                        </Link>
                      </FavoriteSelectableItem>
                    );
                  })}
                </div>
              </FavoriteSelectionManager>
            ) : (
              <div className="messageEmpty favoriteEmpty">
                {favoriteKind === "original"
                  ? uiText(locale, "还没有收藏原创")
                  : mediaKind === "video"
                  ? uiText(locale, "还没有收藏视频")
                  : mediaKind === "audio"
                    ? uiText(locale, "还没有收藏音频")
                    : uiText(locale, "还没有收藏小说")}
              </div>
            )}
            {novelResult ? (
              <Pagination
                page={novelResult.page}
                totalPages={novelResult.totalPages}
                query=""
                basePath="/activity"
                extraParams={{ view: "favorites" }}
              />
            ) : originalResult ? (
              <Pagination
                page={originalResult.page}
                totalPages={originalResult.totalPages}
                query=""
                basePath="/activity"
                extraParams={{ view: "favorites", type: "original" }}
              />
            ) : mediaResult ? (
              <Pagination
                page={mediaResult.page}
                totalPages={mediaResult.totalPages}
                query=""
                basePath="/activity"
                extraParams={{
                  view: "favorites",
                  type: mediaKind === "audio" ? "audio" : "videos",
                }}
              />
            ) : null}
          </>
        )}
      </WorkspacePage>
    </>
  );
}
