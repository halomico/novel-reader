import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { getAdminBookStats } from "@/lib/admin-books";
import {
  getAdminBookPageSize,
  getAdminIndexPageSize,
  getAdminLoginRateLimitPerMinute,
  getAdminOperationRateLimitPerMinute,
  getAdminUsername,
  getAnalyticsRealtimeLimit,
  getCatalogPageSize,
  getContentRateLimitPerMinute,
  getContentRateLimitWindowSeconds,
  getContentIndexHardLimitBytes,
  getContentIndexMaxSegments,
  getContentIndexSoftLimitBytes,
  getFrontendSearchConcurrencyLimit,
  getGlobalSearchMaxResults,
  getManualIndexMaxSegments,
  getNoticeDisplaySeconds,
  getSearchRateLimitPerMinute,
  getSearchResultsPageSize,
  getSearchShortQueryRateLimitPerMinute,
  getUserDailyRegistrationLimitPerIp,
  getUserAvatarMaxBytes,
  getUserSearchRateLimitPerMinute,
  getSiteName,
  getSiteTitle,
  shouldBlockHeadlessBrowsers,
} from "@/lib/config";
import { readSiteSettings } from "@/lib/site-settings";
import { cancelFrontendSearchJobsAction, saveAdminSettingsAction } from "../actions";
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

export default async function AdminSettingsPage({ searchParams }: AdminSettingsPageProps) {
  const params = await searchParams;
  const settings = readSiteSettings();
  const stats = getAdminBookStats();
  const siteName = getSiteName();
  const siteTitle = getSiteTitle();
  const adminUsername = settings.adminUsername || getAdminUsername();
  const loginRateLimit = settings.adminLoginRateLimitPerMinute || getAdminLoginRateLimitPerMinute();
  const operationRateLimit = settings.adminOperationRateLimitPerMinute || getAdminOperationRateLimitPerMinute();
  const catalogPageSize = settings.catalogPageSize || getCatalogPageSize();
  const searchResultsPageSize = settings.searchResultsPageSize || getSearchResultsPageSize();
  const adminBookPageSize = settings.adminBookPageSize || getAdminBookPageSize();
  const adminIndexPageSize = settings.adminIndexPageSize || getAdminIndexPageSize();
  const noticeDisplaySeconds = settings.noticeDisplaySeconds || getNoticeDisplaySeconds();
  const globalSearchMaxResults = settings.globalSearchMaxResults || getGlobalSearchMaxResults();
  const searchRateLimit = settings.searchRateLimitPerMinute || getSearchRateLimitPerMinute();
  const shortSearchRateLimit = settings.searchShortQueryRateLimitPerMinute || getSearchShortQueryRateLimitPerMinute();
  const userDailyRegistrationLimit = settings.userDailyRegistrationLimitPerIp || getUserDailyRegistrationLimitPerIp();
  const userSearchRateLimit = settings.userSearchRateLimitPerMinute || getUserSearchRateLimitPerMinute();
  const userAvatarMaxMb = ((settings.userAvatarMaxBytes || getUserAvatarMaxBytes()) / 1024 ** 2).toFixed(1);
  const analyticsRealtimeLimit = settings.analyticsRealtimeLimit || getAnalyticsRealtimeLimit();
  const frontendSearchConcurrencyLimit = settings.frontendSearchConcurrencyLimit || getFrontendSearchConcurrencyLimit();
  const contentRateLimit = settings.contentRateLimitPerMinute || getContentRateLimitPerMinute();
  const contentRateLimitWindow = settings.contentRateLimitWindowSeconds || getContentRateLimitWindowSeconds();
  const contentIndexMaxSegments = settings.contentIndexMaxSegments || getContentIndexMaxSegments();
  const manualIndexMaxSegments = settings.manualIndexMaxSegments || getManualIndexMaxSegments();
  const contentBlockHeadlessBrowsers = shouldBlockHeadlessBrowsers();
  const softLimitGb = ((settings.contentIndexSoftLimitBytes || getContentIndexSoftLimitBytes()) / 1024 ** 3).toFixed(2);
  const hardLimitGb = ((settings.contentIndexHardLimitBytes || getContentIndexHardLimitBytes()) / 1024 ** 3).toFixed(2);

  return (
    <AdminFrame active="settings" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminSettingsPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>系统设置</h2>
            <p>站点展示、登录安全、索引容量和 IP 规则会写入后台设置文件。</p>
          </div>
          <Settings size={20} aria-hidden="true" />
        </div>

        <form className="adminSettingsForm" action={saveAdminSettingsAction}>
          <section className="adminSettingsSection">
            <h3>基础信息</h3>
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
            <label>
              <span>设置页底部文案</span>
              <textarea name="settingsPreviewText" rows={3} defaultValue={settings.settingsPreviewText} />
            </label>
            <label>
              <span>后台主题默认值</span>
              <select name="adminTheme" defaultValue={settings.adminTheme}>
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
          </section>

          <section className="adminSettingsSection">
            <h3>后台安全</h3>
            <label>
              <span>后台用户名</span>
              <input name="adminUsername" defaultValue={adminUsername} />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>后台新密码</span>
                <input name="newAdminPassword" type="password" placeholder="留空则不修改" />
              </label>
              <label>
                <span>确认后台新密码</span>
                <input name="confirmAdminPassword" type="password" placeholder="再次输入新密码" />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>登录限速 / 分钟</span>
                <input name="adminLoginRateLimitPerMinute" type="number" min="1" max="120" defaultValue={loginRateLimit} />
              </label>
              <label>
                <span>后台写操作限速 / 分钟</span>
                <input name="adminOperationRateLimitPerMinute" type="number" min="1" max="600" defaultValue={operationRateLimit} />
              </label>
            </div>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用登录限速</strong>
                <small>建议保持开启，保护后台密码入口。</small>
              </span>
              <input name="adminLoginRateLimitEnabled" type="checkbox" defaultChecked={settings.adminLoginRateLimitEnabled} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>登录超限自动加入黑名单</strong>
                <small>关闭后只返回限速提示，不写入黑名单。</small>
              </span>
              <input name="adminLoginRateLimitBanEnabled" type="checkbox" defaultChecked={settings.adminLoginRateLimitBanEnabled} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用后台写操作限速</strong>
                <small>限制上传、删除、添加索引等写操作；索引进度轮询不计入。</small>
              </span>
              <input name="adminOperationRateLimitEnabled" type="checkbox" defaultChecked={settings.adminOperationRateLimitEnabled} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>后台写操作超限自动加入黑名单</strong>
                <small>个人使用时建议关闭，避免误封自己的管理 IP。</small>
              </span>
              <input name="adminOperationRateLimitBanEnabled" type="checkbox" defaultChecked={settings.adminOperationRateLimitBanEnabled} />
            </label>
          </section>

          <section className="adminSettingsSection">
            <h3>分页显示</h3>
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
                <span>索引词每页 / 个</span>
                <input name="adminIndexPageSize" type="number" min="1" max="200" defaultValue={adminIndexPageSize} />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>提示显示秒数</span>
                <input name="noticeDisplaySeconds" type="number" min="0" max="60" defaultValue={noticeDisplaySeconds} />
              </label>
            </div>
            <label className="adminSwitchLabel">
              <span>
                <strong>失去焦点后继续显示提示</strong>
                <small>关闭时，浏览器窗口失去焦点会立即隐藏提示消息。</small>
              </span>
              <input name="noticeStayVisibleAfterBlur" type="checkbox" defaultChecked={settings.noticeStayVisibleAfterBlur} />
            </label>
          </section>

          <section className="adminSettingsSection">
            <h3>前台访问限制</h3>
            <div className="adminFieldGrid">
              <label>
                <span>全文搜索限速 / 分钟</span>
                <input name="searchRateLimitPerMinute" type="number" min="1" max="120" defaultValue={searchRateLimit} />
              </label>
              <label>
                <span>短关键词搜索限速 / 分钟</span>
                <input name="searchShortQueryRateLimitPerMinute" type="number" min="1" max="120" defaultValue={shortSearchRateLimit} />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>登录用户搜索限速 / 分钟</span>
                <input name="userSearchRateLimitPerMinute" type="number" min="1" max="600" defaultValue={userSearchRateLimit} />
              </label>
              <label>
                <span>用户头像上限 / MB</span>
                <input name="userAvatarMaxMb" type="number" min="0.1" max="10" step="0.1" defaultValue={userAvatarMaxMb} />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>单 IP 每日注册上限</span>
                <input name="userDailyRegistrationLimitPerIp" type="number" min="0" max="100" defaultValue={userDailyRegistrationLimit} />
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
                <small>开启后只统计小说阅读访问，用于后台分析书籍访问、IP、来源和客户端。</small>
              </span>
              <input name="analyticsEnabled" type="checkbox" defaultChecked={settings.analyticsEnabled} />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>实时访问最多保留 / 条</span>
                <input name="analyticsRealtimeLimit" type="number" min="30" max="2000" defaultValue={analyticsRealtimeLimit} />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>正文访问限速 / 窗口</span>
                <input name="contentRateLimitPerMinute" type="number" min="1" max="600" defaultValue={contentRateLimit} />
              </label>
              <label>
                <span>正文限速窗口 / 秒</span>
                <input name="contentRateLimitWindowSeconds" type="number" min="10" max="3600" defaultValue={contentRateLimitWindow} />
              </label>
            </div>
            <label className="adminSwitchLabel">
              <span>
                <strong>拦截无头浏览器访问正文</strong>
                <small>用于降低脚本化访问正文页面的压力。</small>
              </span>
              <input name="contentBlockHeadlessBrowsers" type="checkbox" defaultChecked={contentBlockHeadlessBrowsers} />
            </label>
          </section>

          <section className="adminSettingsSection">
            <h3>索引策略</h3>
            <label className="adminSwitchLabel">
              <span>
                <strong>显示搜索进度条</strong>
                <small>前台全文搜索和后台手动索引会显示扫描进度。</small>
              </span>
              <input name="showProgressBars" type="checkbox" defaultChecked={settings.showProgressBars} />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>前台搜索后自动建立索引</strong>
                <small>关闭后仍会使用已有索引，但不会把新搜索词写入索引库。</small>
              </span>
              <input name="frontendAutoIndexEnabled" type="checkbox" defaultChecked={settings.frontendAutoIndexEnabled} />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>前台全文最多显示 / 条</span>
                <input name="globalSearchMaxResults" type="number" min="1" max="1000" defaultValue={globalSearchMaxResults} />
              </label>
              <label>
                <span>全文搜索并发上限 / 个</span>
                <input name="frontendSearchConcurrencyLimit" type="number" min="1" max="50" defaultValue={frontendSearchConcurrencyLimit} />
              </label>
            </div>
            <div className="adminActionRow">
              <button className="adminSecondaryButton" type="submit" formAction={cancelFrontendSearchJobsAction}>
                停止所有前台搜索任务
              </button>
              <small>用于释放正在扫描正文或自动建立索引的前台搜索任务。</small>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>前台自动索引片段上限</span>
                <input name="contentIndexMaxSegments" type="number" min="1" max="100000" defaultValue={contentIndexMaxSegments} />
              </label>
            </div>
            <div className="adminFieldGrid">
              <label>
                <span>手动索引片段上限</span>
                <input name="manualIndexMaxSegments" type="number" min="1" max="1000000" defaultValue={manualIndexMaxSegments} />
              </label>
            </div>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用手动索引片段上限</strong>
                <small>默认关闭。关闭时后台手动索引完全不受片段数量限制。</small>
              </span>
              <input name="manualIndexMaxSegmentsEnabled" type="checkbox" defaultChecked={settings.manualIndexMaxSegmentsEnabled} />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>索引库软上限 / GB</span>
                <input name="contentIndexSoftLimitGb" type="number" min="0.1" max="10" step="0.01" defaultValue={softLimitGb} />
              </label>
              <label>
                <span>索引库硬上限 / GB</span>
                <input name="contentIndexHardLimitGb" type="number" min="0.1" max="10" step="0.01" defaultValue={hardLimitGb} />
              </label>
            </div>
          </section>

          <section className="adminSettingsSection">
            <h3>IP 规则</h3>
            <label>
              <span>入站 IP 白名单</span>
              <textarea name="adminAllowedIps" rows={3} defaultValue={settings.adminAllowedIps} placeholder="留空表示不限制，可用英文逗号或换行分隔" />
            </label>
            <label>
              <span>入站 IP 黑名单</span>
              <textarea name="adminBlockedIps" rows={3} defaultValue={settings.adminBlockedIps} />
            </label>
            <div className="adminFieldGrid">
              <label>
                <span>出站 IP 白名单</span>
                <textarea name="adminOutboundAllowedIps" rows={2} defaultValue={settings.adminOutboundAllowedIps} placeholder="当前无外部请求，规则保留给扩展接口" />
              </label>
              <label>
                <span>出站 IP 黑名单</span>
                <textarea name="adminOutboundBlockedIps" rows={2} defaultValue={settings.adminOutboundBlockedIps} />
              </label>
            </div>
          </section>

          <button type="submit">保存设置</button>
        </form>

        <div className="adminPaths">
          <p>
            <strong>书库目录</strong>
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
