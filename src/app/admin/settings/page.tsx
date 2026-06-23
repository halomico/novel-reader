import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { getAdminBookStats } from "@/lib/admin-books";
import { getAdminLoginRateLimitPerMinute, getAdminRateLimitPerMinute, getSiteName, getSiteTitle } from "@/lib/config";
import { readSiteSettings } from "@/lib/site-settings";
import { saveAdminSettingsAction } from "../actions";
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
  const rateLimit = settings.adminRateLimitPerMinute || getAdminRateLimitPerMinute();
  const loginRateLimit = settings.adminLoginRateLimitPerMinute || getAdminLoginRateLimitPerMinute();

  return (
    <AdminFrame active="settings" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminSettingsPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>系统设置</h2>
            <p>站点展示、后台限速和 IP 访问规则会写入后台设置文件。</p>
          </div>
          <Settings size={20} aria-hidden="true" />
        </div>

        <form className="adminSettingsForm" action={saveAdminSettingsAction}>
          <label>
            <span>站点名称</span>
            <input name="siteName" defaultValue={settings.siteName || siteName} />
          </label>
          <label>
            <span>页面标题</span>
            <input name="siteTitle" defaultValue={settings.siteTitle || siteTitle} />
          </label>
          <label>
            <span>阅读页底部文案</span>
            <textarea name="settingsPreviewText" rows={3} defaultValue={settings.settingsPreviewText} />
          </label>
          <label>
            <span>主题默认值</span>
            <select name="adminTheme" defaultValue={settings.adminTheme}>
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <div className="adminFieldGrid">
            <label>
              <span>后台接口限速 / 分钟</span>
              <input name="adminRateLimitPerMinute" type="number" min="1" max="600" defaultValue={rateLimit} />
            </label>
            <label>
              <span>登录限速 / 分钟</span>
              <input name="adminLoginRateLimitPerMinute" type="number" min="1" max="120" defaultValue={loginRateLimit} />
            </label>
          </div>
          <label>
            <span>入站 IP 白名单</span>
            <textarea name="adminAllowedIps" rows={3} defaultValue={settings.adminAllowedIps} placeholder="留空表示不限制，可用英文逗号或换行分隔" />
          </label>
          <label>
            <span>入站 IP 黑名单</span>
            <textarea name="adminBlockedIps" rows={3} defaultValue={settings.adminBlockedIps} />
          </label>
          <label>
            <span>出站 IP 白名单</span>
            <textarea name="adminOutboundAllowedIps" rows={2} defaultValue={settings.adminOutboundAllowedIps} placeholder="当前无外部请求，规则保留给扩展接口" />
          </label>
          <label>
            <span>出站 IP 黑名单</span>
            <textarea name="adminOutboundBlockedIps" rows={2} defaultValue={settings.adminOutboundBlockedIps} />
          </label>
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
