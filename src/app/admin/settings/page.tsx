import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { BookOpen, ChevronRight, Clapperboard, File, Globe2, Headphones, ListFilter, Megaphone, Search, Tags, Trash2, Upload } from "lucide-react";
import { AdminPaletteField } from "@/components/AdminPaletteField";
import { AdminSelect } from "@/components/AdminSelect";
import { HomeCardOrderField } from "@/components/HomeCardOrderField";
import { SiteIconFilePicker } from "@/components/SiteIconFilePicker";
import { getAdminBookStats } from "@/lib/admin-books";
import {
  getAdminBookPageSize,
  getAdminLoginRateLimitPerMinute,
  getAdminUsername,
  getAnalyticsRealtimeLimit,
  getCatalogPageSize,
  getFrontendSearchConcurrencyLimit,
  getGlobalSearchMaxResults,
  getNoticeDisplaySeconds,
  getReaderDefaultFontSize,
  getSearchResultsPageSize,
  getUserDailyRegistrationLimitPerIp,
  getUserDailyReportLimit,
  getUserAvatarMaxBytes,
  getSiteName,
  getSiteTitle,
} from "@/lib/config";
import { readSiteSettings } from "@/lib/site-settings";
import { getSiteIconHref } from "@/lib/site-icon";
import {
  resolveHomePortalAccessMode,
  type HomePortalContentCardKey,
} from "@/lib/home-portal";
import { countRecommendationPoolNovels } from "@/lib/recommendation-pool";
import { normalizeReaderLineHeight, READER_LINE_HEIGHTS } from "@/lib/ui-preferences";
import {
  cancelFrontendSearchJobsAction,
  deleteSiteIconAction,
  saveAdminSettingsAction,
  uploadSiteIconAction,
} from "../actions";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminSettingsPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

function mediaAccessMode(enabled: boolean, guestEnabled: boolean): "off" | "user" | "public" {
  if (!enabled) return "off";
  return guestEnabled ? "public" : "user";
}

function homeCardAccessMode(
  key: HomePortalContentCardKey,
  enabled: boolean,
  guestEnabled: boolean,
  publicDisplayCards: readonly HomePortalContentCardKey[],
) {
  return resolveHomePortalAccessMode(enabled, guestEnabled, publicDisplayCards.includes(key));
}

export default async function AdminSettingsPage({ searchParams }: AdminSettingsPageProps) {
  const params = await searchParams;
  const settings = readSiteSettings();
  const stats = getAdminBookStats();
  const siteName = getSiteName();
  const siteTitle = getSiteTitle();
  const adminUsername = settings.adminUsername || getAdminUsername();
  const loginRateLimit = settings.adminLoginRateLimitPerMinute || getAdminLoginRateLimitPerMinute();
  const catalogPageSize = settings.catalogPageSize || getCatalogPageSize();
  const searchResultsPageSize = settings.searchResultsPageSize || getSearchResultsPageSize();
  const adminBookPageSize = settings.adminBookPageSize || getAdminBookPageSize();
  const noticeDisplaySeconds = settings.noticeDisplaySeconds || getNoticeDisplaySeconds();
  const readerDefaultFontSize = settings.readerDefaultFontSize || getReaderDefaultFontSize();
  const readerDefaultLineHeight = normalizeReaderLineHeight(settings.readerDefaultLineHeight);
  const globalSearchMaxResults = settings.globalSearchMaxResults || getGlobalSearchMaxResults();
  const userDailyRegistrationLimit = settings.userDailyRegistrationLimitPerIp || getUserDailyRegistrationLimitPerIp();
  const userDailyReportLimit = settings.userDailyReportLimit || getUserDailyReportLimit();
  const userAvatarMaxMb = ((settings.userAvatarMaxBytes || getUserAvatarMaxBytes()) / 1024 ** 2).toFixed(1);
  const analyticsRealtimeLimit = settings.analyticsRealtimeLimit || getAnalyticsRealtimeLimit();
  const frontendSearchConcurrencyLimit = settings.frontendSearchConcurrencyLimit || getFrontendSearchConcurrencyLimit();
  const siteIconHref = getSiteIconHref();
  const recommendationPoolCount = countRecommendationPoolNovels();

  return (
    <AdminFrame active="settings" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminSettingsPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>系统设置</h2>
            <p>管理站点展示、账户入口、内容开放范围与搜索行为。</p>
          </div>
          <Settings size={20} aria-hidden="true" />
        </div>

        <form className="adminSettingsSection siteIconManager" action={uploadSiteIconAction}>
          <div className="siteIconPreview" aria-label="当前浏览器标签图标">
            {siteIconHref ? (
              <img
                src={siteIconHref}
                alt="当前站点图标"
                width="48"
                height="48"
              />
            ) : (
              <Globe2 size={24} aria-hidden="true" />
            )}
          </div>
          <SiteIconFilePicker />
          <div className="siteIconActions">
            <button className="adminMediaUploadButton" type="submit">
              <Upload size={15} aria-hidden="true" />
              上传
            </button>
            <button
              className="searchRateRuleIconButton isDanger"
              type="submit"
              formAction={deleteSiteIconAction}
              formNoValidate
              disabled={!settings.siteIconFileName}
              aria-label="删除站点图标"
              title="删除站点图标"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        </form>

        <form className="adminSettingsForm" action={saveAdminSettingsAction}>
          <details className="adminSettingsSection adminSettingsDisclosure" open>
            <summary>基础信息</summary>
            <div className="adminFieldGrid">
              <label>
                <span>站点名称</span>
                <input name="siteName" defaultValue={settings.siteName || siteName} />
              </label>
              <label>
                <span>页面标题</span>
                <input name="siteTitle" defaultValue={settings.siteTitle || siteTitle} />
              </label>
            </div>
            <label className="adminCompactField">
              <span>站点标识跳转</span>
              <AdminSelect name="brandLinkTarget" defaultValue={settings.brandLinkTarget}>
                <option value="novels">小说</option>
                <option value="home">首页</option>
              </AdminSelect>
            </label>
            <label>
              <span>设置页底部文案</span>
              <textarea name="settingsPreviewText" rows={3} defaultValue={settings.settingsPreviewText} />
            </label>
            <div className="adminFieldGrid adminReaderDefaults">
              <label>
                <span>默认正文字号 / px</span>
                <input name="readerDefaultFontSize" type="number" min="8" max="25" defaultValue={readerDefaultFontSize} />
              </label>
              <label>
                <span>默认正文行距</span>
                <AdminSelect name="readerDefaultLineHeight" defaultValue={String(readerDefaultLineHeight)}>
                  {READER_LINE_HEIGHTS.map((value) => (
                    <option key={value} value={String(value)}>{value.toFixed(1)} 倍</option>
                  ))}
                </AdminSelect>
              </label>
            </div>
            <label className="adminCompactField">
              <span>文章标签默认显示</span>
              <AdminSelect name="readerDefaultTagsMode" defaultValue={settings.readerDefaultTagsMode}>
                <option value="collapsed">收起</option>
                <option value="expanded">展开</option>
                <option value="hidden">关闭</option>
              </AdminSelect>
            </label>
            <label className="adminCompactField">
              <span>默认明暗模式</span>
              <AdminSelect name="adminTheme" defaultValue={settings.adminTheme}>
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </AdminSelect>
            </label>
            <AdminPaletteField defaultValue={settings.defaultPalette} />
            <label className="adminSwitchLabel">
              <span>
                <strong>定时随机切换默认配色</strong>
                <small>只影响没有保存个人配色的浏览器，周期内所有页面保持一致。</small>
              </span>
              <input name="defaultPaletteRandomEnabled" type="checkbox" defaultChecked={settings.defaultPaletteRandomEnabled} />
            </label>
            <label className="adminCompactField isNarrow">
              <span>配色切换周期 / 分钟</span>
              <input
                name="defaultPaletteRotationMinutes"
                type="number"
                min="1"
                max="10080"
                defaultValue={settings.defaultPaletteRotationMinutes}
              />
            </label>
          </details>

          <details className="adminSettingsSection adminSettingsDisclosure">
            <summary>后台安全</summary>
            <label>
              <span>后台用户名</span>
              <input name="adminUsername" defaultValue={adminUsername} />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>后台新密码</span>
                <input name="newAdminPassword" type="password" minLength={6} maxLength={72} placeholder="留空则不修改" />
              </label>
              <label>
                <span>确认后台新密码</span>
                <input name="confirmAdminPassword" type="password" minLength={6} maxLength={72} placeholder="再次输入新密码" />
              </label>
            </div>
            <label className="adminCompactField isNarrow">
              <span>登录限速 / 分钟</span>
              <input name="adminLoginRateLimitPerMinute" type="number" min="1" max="120" defaultValue={loginRateLimit} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用登录限速</strong>
                <small>建议保持开启，保护后台密码入口。</small>
              </span>
              <input name="adminLoginRateLimitEnabled" type="checkbox" defaultChecked={settings.adminLoginRateLimitEnabled} />
            </label>
            <label>
              <span>后台访问白名单</span>
              <textarea
                name="adminAllowedNetworks"
                rows={3}
                defaultValue={settings.adminAllowedNetworks.join("\n")}
                placeholder="每行一个 IP 或 CIDR"
              />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用后台访问白名单</strong>
                <small>仅限制后台入口；保存时会确认当前 IP 已包含在规则中。</small>
              </span>
              <input name="adminIpAllowlistEnabled" type="checkbox" defaultChecked={settings.adminIpAllowlistEnabled} />
            </label>
          </details>

          <details className="adminSettingsSection adminSettingsDisclosure">
            <summary>分页显示</summary>
            <div className="adminFieldGrid">
              <label>
                <span>首页书名每页 / 本</span>
                <input name="catalogPageSize" type="number" min="1" max="100" defaultValue={catalogPageSize} />
              </label>
              <label>
                <span>全文搜索每页 / 条</span>
                <input name="searchResultsPageSize" type="number" min="1" max="100" defaultValue={searchResultsPageSize} />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>后台小说每页 / 本</span>
                <input name="adminBookPageSize" type="number" min="1" max="200" defaultValue={adminBookPageSize} />
              </label>
              <label>
                <span>提示显示秒数（0 为持续显示）</span>
                <input name="noticeDisplaySeconds" type="number" min="0" max="60" defaultValue={noticeDisplaySeconds} />
              </label>
              <label>
                <span>音频默认播放</span>
                <AdminSelect name="audioDefaultPlaybackMode" defaultValue={settings.audioDefaultPlaybackMode}>
                  <option value="next">自动连播</option>
                  <option value="stop">播完暂停</option>
                  <option value="repeat-one">单曲循环</option>
                </AdminSelect>
              </label>
            </div>
            <label className="adminSwitchLabel">
              <span>
                <strong>显示随便看看</strong>
              </span>
              <input name="randomCatalogEnabled" type="checkbox" defaultChecked={settings.randomCatalogEnabled} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用手动置顶</strong>
                <small>关闭后保留置顶列表，但前台暂不提升这些小说的排序。</small>
              </span>
              <input name="manualPinnedNovelsEnabled" type="checkbox" defaultChecked={settings.manualPinnedNovelsEnabled} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用随机推荐</strong>
                <small>每个周期从精选推荐池等权抽取，当前 {recommendationPoolCount} 本。</small>
              </span>
              <input name="randomRecommendationsEnabled" type="checkbox" defaultChecked={settings.randomRecommendationsEnabled} />
            </label>
            <label className="adminCompactField">
              <span>置顶显示顺序</span>
              <AdminSelect name="catalogPromotionOrder" defaultValue={settings.catalogPromotionOrder}>
                <option value="manual-first">手动置顶在前</option>
                <option value="random-first">随机推荐在前</option>
              </AdminSelect>
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>随机推荐数量 / 本</span>
                <input name="randomRecommendationCount" type="number" min="1" max="50" defaultValue={settings.randomRecommendationCount} />
              </label>
              <label>
                <span>推荐切换周期 / 分钟</span>
                <input
                  name="randomRecommendationIntervalMinutes"
                  type="number"
                  min="1"
                  max="10080"
                  defaultValue={settings.randomRecommendationIntervalMinutes}
                />
              </label>
            </div>
          </details>

          <details className="adminSettingsSection adminSettingsDisclosure">
            <summary>账户与内容访问</summary>
            <div className="adminFieldGrid">
              <label>
                <span>用户头像上限 / MB</span>
                <input name="userAvatarMaxMb" type="number" min="0.1" max="10" step="0.1" defaultValue={userAvatarMaxMb} />
              </label>
              <label>
                <span>站务显示名称</span>
                <input name="stationDisplayName" maxLength={20} defaultValue={settings.stationDisplayName} />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>单 IP 每日注册上限</span>
                <input name="userDailyRegistrationLimitPerIp" type="number" min="0" max="100" defaultValue={userDailyRegistrationLimit} />
              </label>
              <label>
                <span>单用户每日举报上限</span>
                <input name="userDailyReportLimit" type="number" min="1" max="500" defaultValue={userDailyReportLimit} />
              </label>
            </div>
            <label className="adminSwitchLabel">
              <span>
                <strong>开放前台登录</strong>
                <small>关闭后未登录用户不能登录；已登录用户仍可退出。</small>
              </span>
              <input name="userLoginEnabled" type="checkbox" defaultChecked={settings.userLoginEnabled} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>开放前台注册</strong>
                <small>关闭后注册页和右上角注册入口会隐藏或不可用。</small>
              </span>
              <input name="userRegistrationEnabled" type="checkbox" defaultChecked={settings.userRegistrationEnabled} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用访问数据统计</strong>
                <small>统计小说与资源访问，用于分析内容、IP、来源和客户端。</small>
              </span>
              <input name="analyticsEnabled" type="checkbox" defaultChecked={settings.analyticsEnabled} />
            </label>
            <div className="adminAccessSettings">
              <h4>前台资源访问</h4>
              <div className="adminAccessModeGrid">
                <label className="adminAccessModeRow">
                  <span><BookOpen size={16} aria-hidden="true" /><strong>小说</strong></span>
                  <AdminSelect name="novelAccessMode" defaultValue={homeCardAccessMode("novels", settings.novelLibraryEnabled, settings.guestLibraryNavEnabled, settings.publicDisplayHomeCards)}>
                    <option value="public">公开访问</option>
                    <option value="preview">公开展示</option>
                    <option value="member">登录可见</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Clapperboard size={16} aria-hidden="true" /><strong>视频</strong></span>
                  <AdminSelect name="videoAccessMode" defaultValue={homeCardAccessMode("video", settings.videoLibraryEnabled, settings.guestVideoNavEnabled, settings.publicDisplayHomeCards)}>
                    <option value="public">公开访问</option>
                    <option value="preview">公开展示</option>
                    <option value="member">登录可见</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Headphones size={16} aria-hidden="true" /><strong>音频</strong></span>
                  <AdminSelect name="audioAccessMode" defaultValue={homeCardAccessMode("audio", settings.audioLibraryEnabled, settings.guestAudioNavEnabled, settings.publicDisplayHomeCards)}>
                    <option value="public">公开访问</option>
                    <option value="preview">公开展示</option>
                    <option value="member">登录可见</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><File size={16} aria-hidden="true" /><strong>文件</strong></span>
                  <AdminSelect name="fileAccessMode" defaultValue={homeCardAccessMode("file", settings.fileLibraryEnabled, settings.guestFileNavEnabled, settings.publicDisplayHomeCards)}>
                    <option value="public">公开访问</option>
                    <option value="preview">公开展示</option>
                    <option value="member">登录可见</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Tags size={16} aria-hidden="true" /><strong>标签</strong></span>
                  <AdminSelect name="tagAccessMode" defaultValue={homeCardAccessMode("tags", settings.tagLibraryEnabled, settings.guestTagLibraryNavEnabled, settings.publicDisplayHomeCards)}>
                    <option value="public">公开访问</option>
                    <option value="preview">公开展示</option>
                    <option value="member">登录可见</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Megaphone size={16} aria-hidden="true" /><strong>公告卡片</strong></span>
                  <AdminSelect
                    name="announcementCardAccessMode"
                    defaultValue={homeCardAccessMode("announcement", settings.announcementCardEnabled, settings.guestAnnouncementCardEnabled, settings.publicDisplayHomeCards)}
                  >
                    <option value="public">公开访问</option>
                    <option value="preview">公开展示</option>
                    <option value="member">登录可见</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><ChevronRight size={16} aria-hidden="true" /><strong>公告跳转</strong></span>
                  <AdminSelect name="announcementCardTarget" defaultValue={settings.announcementCardTarget}>
                    <option value="list">公告列表</option>
                    <option value="latest">最新公告</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><ListFilter size={16} aria-hidden="true" /><strong>高级搜索</strong></span>
                  <AdminSelect name="advancedTagAccessMode" defaultValue={mediaAccessMode(settings.advancedTagSearchEnabled, settings.guestAdvancedTagSearchEnabled)}>
                    <option value="off">关闭</option>
                    <option value="public">公开访问</option>
                    <option value="user">登录可用</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Search size={16} aria-hidden="true" /><strong>文末热词</strong></span>
                  <AdminSelect name="hotwordAccessMode" defaultValue={mediaAccessMode(settings.hotwordLinksEnabled, settings.guestHotwordLinksEnabled)}>
                    <option value="off">关闭</option>
                    <option value="public">公开访问</option>
                    <option value="user">登录可用</option>
                  </AdminSelect>
                </label>
              </div>
              <p className="adminFieldHint">公开展示仅让访客看到首页入口，内容仍需登录；登录可见会同时隐藏访客入口。</p>
              <HomeCardOrderField initialOrder={settings.homePortalOrder} />
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>实时访问最多保留 / 条</span>
                <input name="analyticsRealtimeLimit" type="number" min="30" max="2000" defaultValue={analyticsRealtimeLimit} />
              </label>
            </div>
          </details>

          <details className="adminSettingsSection adminSettingsDisclosure">
            <summary>索引策略</summary>
            <label className="adminSwitchLabel">
              <span>
                <strong>显示搜索进度条</strong>
                <small>前台全文搜索和后台全文索引构建会显示处理进度。</small>
              </span>
              <input name="showProgressBars" type="checkbox" defaultChecked={settings.showProgressBars} />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>前台全文最多显示 / 条</span>
                <input name="globalSearchMaxResults" type="number" min="1" max="1000" defaultValue={globalSearchMaxResults} />
              </label>
              <label>
                <span>全文搜索并发上限 / 个</span>
                <input name="frontendSearchConcurrencyLimit" type="number" min="1" max="100" defaultValue={frontendSearchConcurrencyLimit} />
              </label>
            </div>
            <div className="adminActionRow">
              <button className="adminSecondaryButton" type="submit" formAction={cancelFrontendSearchJobsAction}>
                停止所有前台搜索任务
              </button>
              <small>索引构建与存储状态统一在“搜索索引”页面管理。</small>
            </div>
          </details>

          <button type="submit">保存设置</button>
        </form>

        <div className="adminPaths">
          <p>
            <strong>小说目录</strong>
            <span>{stats.libraryDir}</span>
          </p>
          <p>
            <strong>数据库</strong>
            <span>{stats.databasePath}</span>
          </p>
          <p>
            <strong>后台设置</strong>
            <span>{stats.adminSettingsPath}</span>
          </p>
        </div>
      </article>
    </AdminFrame>
  );
}
