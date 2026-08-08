import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { BookOpen, ChevronRight, Clapperboard, File, Globe2, Headphones, ListFilter, Megaphone, Search, Tags, Trash2, Upload } from "lucide-react";
import { AdminPaletteField } from "@/components/AdminPaletteField";
import { AdminSelect } from "@/components/AdminSelect";
import { AdminSwitchRow } from "@/components/AdminSwitchRow";
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
  ALL_NOVEL_LIBRARIES_SLUG,
  listNovelSources,
  novelLibraryDisplayName,
} from "@/lib/novel-library";
import { countRecommendationPoolNovels } from "@/lib/recommendation-pool";
import { isEmailVerificationConfigured } from "@/lib/email-verification";
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
  const novelSources = listNovelSources({ includeEmpty: true });
  const defaultNovelLibrarySlug = settings.defaultNovelLibrarySlug === ALL_NOVEL_LIBRARIES_SLUG ||
    novelSources.some((source) => source.slug === settings.defaultNovelLibrarySlug)
    ? settings.defaultNovelLibrarySlug
    : "default";
  const recommendationPoolCount = countRecommendationPoolNovels();
  const mailConfigured = isEmailVerificationConfigured();

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
            <label className="adminCompactField">
              <span>默认进入书库</span>
              <AdminSelect name="defaultNovelLibrarySlug" defaultValue={defaultNovelLibrarySlug}>
                {novelSources.map((source) => (
                  <option value={source.slug} key={source.id}>
                    {novelLibraryDisplayName(source)}（{source.novelCount} 本）
                  </option>
                ))}
                <option value={ALL_NOVEL_LIBRARIES_SLUG}>全部书库</option>
              </AdminSelect>
              <small>仅影响尚未保存个人书库选择的用户；用户手动选择后以个人选择为准。</small>
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
            <AdminSwitchRow
              name="defaultPaletteRandomEnabled"
              title="定时随机切换默认配色"
              description="只影响没有保存个人配色的浏览器，周期内所有页面保持一致。"
              defaultChecked={settings.defaultPaletteRandomEnabled}
            />
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
              <input name="adminUsername" defaultValue={adminUsername} autoComplete="username" />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>后台新密码</span>
                {/* No minLength: empty means unchanged; length validated server-side when set */}
                <input name="newAdminPassword" type="password" maxLength={72} autoComplete="new-password" placeholder="留空则不修改" />
              </label>
              <label>
                <span>确认后台新密码</span>
                <input name="confirmAdminPassword" type="password" maxLength={72} autoComplete="new-password" placeholder="再次输入新密码" />
              </label>
            </div>
            <label className="adminCompactField isNarrow">
              <span>登录限速 / 分钟</span>
              <input name="adminLoginRateLimitPerMinute" type="number" min="1" max="120" defaultValue={loginRateLimit} />
            </label>
            <AdminSwitchRow name="adminLoginRateLimitEnabled" title="启用登录限速" description="建议保持开启，保护后台密码入口。" defaultChecked={settings.adminLoginRateLimitEnabled} />
            <label>
              <span>后台访问白名单</span>
              <textarea
                name="adminAllowedNetworks"
                rows={3}
                defaultValue={settings.adminAllowedNetworks.join("\n")}
                placeholder="每行一个 IP 或 CIDR"
              />
            </label>
            <AdminSwitchRow name="adminIpAllowlistEnabled" title="启用后台访问白名单" description="仅限制后台入口；保存时会确认当前 IP 已包含在规则中。" defaultChecked={settings.adminIpAllowlistEnabled} />
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
            <AdminSwitchRow name="randomCatalogEnabled" title="显示随便看看" defaultChecked={settings.randomCatalogEnabled} />
            <AdminSwitchRow name="manualPinnedNovelsEnabled" title="启用手动置顶" description="关闭后保留置顶列表，但前台暂不提升这些小说的排序。" defaultChecked={settings.manualPinnedNovelsEnabled} />
            <AdminSwitchRow name="randomRecommendationsEnabled" title="启用随机推荐" description={`每个周期从精选推荐池等权抽取，当前 ${recommendationPoolCount} 本。`} defaultChecked={settings.randomRecommendationsEnabled} />
            <label className="adminCompactField">
              <span>置顶显示顺序</span>
              <AdminSelect name="catalogPromotionOrder" defaultValue={settings.catalogPromotionOrder}>
                <option value="manual-first">手动置顶在前</option>
                <option value="random-first">随机推荐在前</option>
              </AdminSelect>
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>每轮随机展示 / 本</span>
                <input name="randomRecommendationCount" type="number" min="1" max="1000" defaultValue={settings.randomRecommendationCount} />
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
                <span>单用户每日反馈上限</span>
                <input name="userDailyReportLimit" type="number" min="1" max="500" defaultValue={userDailyReportLimit} />
              </label>
            </div>
            <AdminSwitchRow name="userLoginEnabled" title="开放前台登录" description="关闭后未登录用户不能登录；已登录用户仍可退出。" defaultChecked={settings.userLoginEnabled} />
            <label className="adminCompactField">
              <span>注册方式</span>
              <AdminSelect name="userRegistrationMode" defaultValue={settings.userRegistrationMode}>
                <option value="closed">关闭</option>
                <option value="invite">邀请码</option>
                <option value="open">开放注册</option>
              </AdminSelect>
            </label>
            <AdminSwitchRow
              name="emailVerificationRequired"
              title="注册后验证邮箱"
              description={mailConfigured ? "验证通过后账号可登录。" : "请先配置 SMTP 与 SITE_URL。"}
              status={mailConfigured ? "已就绪" : "未配置"}
              defaultChecked={settings.emailVerificationRequired}
              disabled={!mailConfigured}
            />
            <AdminSwitchRow name="marketEnabled" title="启用集市" description="入口仍受用户等级权限控制。" defaultChecked={settings.marketEnabled} />
            <label className="adminCompactField isNarrow">
              <span>每曲奇兑换苏打</span>
              <input
                name="cookieToSodaRate"
                type="number"
                min="1"
                max="10000"
                defaultValue={settings.cookieToSodaRate}
              />
            </label>
            <AdminSwitchRow name="analyticsEnabled" title="启用访问数据统计" description="统计小说与资源访问，用于分析内容、IP、来源和客户端。" defaultChecked={settings.analyticsEnabled} />
            <div className="adminAccessSettings">
              <h4>前台资源访问</h4>
              <div className="adminAccessModeGrid">
                <label className="adminAccessModeRow">
                  <span><BookOpen size={16} aria-hidden="true" /><strong>小说</strong></span>
                  <AdminSelect name="novelAccessMode" defaultValue={settings.homePortalAccessModes.novels}>
                    <option value="public">公开可用</option>
                    <option value="browse">公开展示</option>
                    <option value="member">登录可用</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Clapperboard size={16} aria-hidden="true" /><strong>视频</strong></span>
                  <AdminSelect name="videoAccessMode" defaultValue={settings.homePortalAccessModes.video}>
                    <option value="public">公开可用</option>
                    <option value="browse">公开展示</option>
                    <option value="member">登录可用</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Headphones size={16} aria-hidden="true" /><strong>音频</strong></span>
                  <AdminSelect name="audioAccessMode" defaultValue={settings.homePortalAccessModes.audio}>
                    <option value="public">公开可用</option>
                    <option value="browse">公开展示</option>
                    <option value="member">登录可用</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><File size={16} aria-hidden="true" /><strong>文件</strong></span>
                  <AdminSelect name="fileAccessMode" defaultValue={settings.homePortalAccessModes.file}>
                    <option value="public">公开可用</option>
                    <option value="browse">公开展示</option>
                    <option value="member">登录可用</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Tags size={16} aria-hidden="true" /><strong>标签</strong></span>
                  <AdminSelect name="tagAccessMode" defaultValue={settings.homePortalAccessModes.tags}>
                    <option value="public">公开可用</option>
                    <option value="browse">公开展示</option>
                    <option value="member">登录可用</option>
                    <option value="off">关闭</option>
                  </AdminSelect>
                </label>
                <label className="adminAccessModeRow">
                  <span><Megaphone size={16} aria-hidden="true" /><strong>公告</strong></span>
                  <AdminSelect
                    name="announcementCardAccessMode"
                    defaultValue={settings.homePortalAccessModes.announcement}
                  >
                    <option value="public">公开可用</option>
                    <option value="browse">公开展示</option>
                    <option value="member">登录可用</option>
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
              <p className="adminFieldHint">公开展示允许访客浏览列表、标题、封面和基础信息，播放、阅读、预览或下载时提示登录；公开可用允许访客直接使用内容。</p>
              <HomeCardOrderField initialOrder={settings.homePortalOrder} />
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>实时访问最多保留 / 条</span>
                <input name="analyticsRealtimeLimit" type="number" min="30" max="10000" defaultValue={analyticsRealtimeLimit} />
              </label>
            </div>
          </details>

          <details className="adminSettingsSection adminSettingsDisclosure">
            <summary>索引策略</summary>
            <AdminSwitchRow name="showProgressBars" title="显示搜索进度条" description="前台全文搜索和后台全文索引构建会显示处理进度。" defaultChecked={settings.showProgressBars} />
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

          <div className="adminSettingsSaveBar">
            <button className="adminSettingsSaveButton" type="submit">
              保存设置
            </button>
          </div>
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
