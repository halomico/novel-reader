import {
  Activity,
  Bean,
  BookOpen,
  Disc3,
  Film,
  Headphones,
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
import { Pagination } from "@/components/Pagination";
import { ReadingHistoryList } from "@/components/ReadingHistoryList";
import { ResultCount } from "@/components/ResultCount";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getVideoThumbnailSettings, isTagLibraryEnabled } from "@/lib/config";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { formatCompactUpdateDate, formatLocalDateTime, parseAppDateTime, toDateTimeAttribute } from "@/lib/date-time";
import { listFavoriteMedia, listFavoriteNovels } from "@/lib/favorites";
import {
  listGrovePage,
  normalizeGroveStage,
  type GroveItem,
  type GroveKind,
  type GroveStage,
} from "@/lib/grove";
import { isMediaKindPublic } from "@/lib/media";
import { formatMediaDuration } from "@/lib/media-format";
import { directMediaThumbnailUrl } from "@/lib/media-thumbnail-url";
import { listReadingProgressPage } from "@/lib/reading-progress";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { filterTagsByNovelForUser } from "@/lib/tag-preferences";
import { listTagsForNovels } from "@/lib/tags";
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
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return uiText(locale, "刚刚");
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}${uiText(locale, "分钟前")}`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}${uiText(locale, "小时前")}`;
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))}${uiText(locale, "天前")}`;
  return formatCompactUpdateDate(timestamp, { now });
}

function GroveCard({ item, locale, returnHref }: {
  item: GroveItem;
  locale: Awaited<ReturnType<typeof getRequestLocale>>;
  returnHref: string;
}) {
  const Icon = item.kind === "novel" ? BookOpen : item.kind === "video" ? Film : Headphones;
  const StageIcon = GROVE_STAGE_ICONS[item.stage];
  const typeLabel = uiText(locale, item.kind === "novel" ? "小说" : item.kind === "video" ? "视频" : "音频");
  const title = item.kind === "novel" ? item.title : displayMediaTitle(item.title, item.fileName);
  const metadata = item.kind === "novel"
    ? [formatNovelWordCount(item.wordCount), item.chapterCount ? `${item.chapterCount}章` : ""].filter(Boolean).join(" · ")
    : item.kind === "audio"
      ? [item.artist, formatMediaDuration(item.durationSeconds)].filter(Boolean).join(" · ")
      : formatMediaDuration(item.durationSeconds);
  const contentHref = item.kind === "novel"
    ? `${item.storageMode === "chapters" ? `/books/${item.id}/chapters` : `/books/${item.id}`}?from=${encodeURIComponent(returnHref)}`
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
  const groveStage = normalizeGroveStage(params.stage);
  const mediaKind = params.type === "videos" ? "video" : params.type === "audio" ? "audio" : null;
  const requestHeaders = await headers();
  const allowedGroveKinds: GroveKind[] = view === "grove"
    ? (["novel", "video", "audio"] as const).filter((scope) => checkContentAccess(requestHeaders, {
        scope,
        authenticated: true,
        admin: user.role === "admin",
        rateLimit: false,
      }).allowed)
    : [];
  if (view === "grove") {
    if (!allowedGroveKinds.length) notFound();
  } else {
    const access = checkContentAccess(requestHeaders, {
      scope: mediaKind || "novel",
      authenticated: true,
      admin: user.role === "admin",
      rateLimit: false,
    });
    if (!access.allowed) notFound();
  }
  const recent = view === "recent"
    ? user.readingHistoryEnabled
      ? listReadingProgressPage(user.id, {
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
  const novelResult = view === "favorites" && !mediaKind
    ? listFavoriteNovels(user.id, Number(params.page || 1), ACTIVITY_PAGE_SIZE)
    : null;
  const mediaResult = view === "favorites" && mediaKind
    ? listFavoriteMedia(user.id, mediaKind, Number(params.page || 1), ACTIVITY_PAGE_SIZE)
    : null;
  const groveResult = view === "grove"
    ? listGrovePage(user.id, {
        stage: groveStage,
        allowedKinds: allowedGroveKinds,
        page: Number(params.page || 1),
        pageSize: ACTIVITY_PAGE_SIZE,
      })
    : null;
  const sourceTags = novelResult && isTagLibraryEnabled()
    ? listTagsForNovels(
        novelResult.books.map((book) => book.id),
        { audience: user.role === "admin" ? "admin" : "member" },
      )
    : new Map();
  const tagsByNovel = filterTagsByNovelForUser(sourceTags, user.id);
  const displayRecent = recent
    ? {
        ...recent,
        items: await Promise.all(recent.items.map(async (item) => ({
          ...item,
          title: await localizeText(item.title, locale),
        }))),
      }
    : null;
  const displayNovelResult = novelResult
    ? {
        ...novelResult,
        books: await Promise.all(novelResult.books.map(async (book) => ({
          ...book,
          title: await localizeText(book.title, locale),
        }))),
      }
    : null;
  const displayMediaResult = mediaResult
    ? {
        ...mediaResult,
        assets: await Promise.all(mediaResult.assets.map(async (asset) => ({
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
          ...(item.kind !== "novel" && item.artist
            ? { artist: await localizeText(item.artist, locale) }
            : {}),
        }))),
      }
    : null;
  const displayTagsByNovel = new Map(
    await Promise.all(Array.from(tagsByNovel, async ([novelId, tags]) => [
      novelId,
      await Promise.all(tags.map(async (tag) => ({
        ...tag,
        name: await localizeText(tag.name, locale),
      }))),
    ] as const)),
  );
  const thumbnailSettings = getVideoThumbnailSettings();
  const directThumbnails = mediaKind === "video" && !hasScopedContentAccessRules("video");
  const publiclyAccessibleThumbnails = directThumbnails && isMediaKindPublic("video");
  const total = recent?.totalItems ?? groveResult?.totalItems ?? mediaResult?.totalAssets ?? novelResult?.totalBooks ?? 0;
  const [
    activityLabel,
    recentLabel,
    favoritesLabel,
    groveLabel,
    personalContentLabel,
    favoriteTypeLabel,
    novelsLabel,
    videosLabel,
    audioLabel,
  ] = await localizeTexts(
    ["动态", "最近", "收藏", "回响林", "个人内容", "收藏类型", "小说", "视频", "音频"] as const,
    locale,
  );

  return (
    <UserWorkspace user={user} active="activity" breadcrumb={activityLabel}>
      <section className="activityLibrary">
        <header className="userContentHeader">
          <span><Activity size={19} aria-hidden="true" /><h1>{activityLabel}</h1></span>
          {view === "recent" && !user.readingHistoryEnabled
            ? null
            : <ResultCount count={total} unit={view === "grove" ? uiText(locale, "项") : undefined} />}
        </header>
        <nav className="messagesTabs activityTabs" aria-label={personalContentLabel}>
          <Link className={view === "recent" ? "isActive" : ""} href="/activity">{recentLabel}</Link>
          <Link className={view === "favorites" ? "isActive" : ""} href="/activity?view=favorites">{favoritesLabel}</Link>
          <Link className={view === "grove" ? "isActive" : ""} href="/activity?view=grove">{groveLabel}</Link>
        </nav>

        {displayRecent ? (
          <ReadingHistoryList
            initialItems={displayRecent.items}
            page={displayRecent.page}
            totalPages={displayRecent.totalPages}
            locale={locale}
            historyEnabled={user.readingHistoryEnabled}
          />
        ) : displayGroveResult ? (
          <>
            <section className="groveOverview" aria-labelledby="grove-title">
              <header className="groveIntro">
                <Trees className="groveIntroIcon" size={36} strokeWidth={1.65} aria-hidden="true" />
                <div className="groveIntroCopy">
                  <h2 id="grove-title">{groveLabel}</h2>
                  <p>{uiText(locale, "把值得反复阅读、观看和聆听的内容种进来，访问越多，它生长得越茂盛。")}</p>
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
            <nav className="messagesTabs favoriteTabs" aria-label={favoriteTypeLabel}>
              <Link className={!mediaKind ? "isActive" : ""} href="/activity?view=favorites">{novelsLabel}</Link>
              <Link className={mediaKind === "video" ? "isActive" : ""} href="/activity?view=favorites&type=videos">{videosLabel}</Link>
              <Link className={mediaKind === "audio" ? "isActive" : ""} href="/activity?view=favorites&type=audio">{audioLabel}</Link>
            </nav>
            {displayNovelResult?.books.length ? (
              <FavoriteSelectionManager
                kind="novel"
                visibleIds={displayNovelResult.books.map((book) => book.id)}
                locale={locale}
              >
                <section className="bookGrid favoriteBookGrid" aria-label={uiText(locale, "收藏小说")}>
                  {displayNovelResult.books.map((book) => (
                    <FavoriteSelectableItem id={book.id} label={book.title} key={book.id}>
                      <CatalogBookCard
                        book={book}
                        returnHref={`/activity?view=favorites&page=${displayNovelResult.page}`}
                        tags={displayTagsByNovel.get(book.id) || []}
                      />
                    </FavoriteSelectableItem>
                  ))}
                </section>
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
                {mediaKind === "video"
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
      </section>
    </UserWorkspace>
  );
}
