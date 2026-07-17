import type { Metadata } from "next";
import { BarChart3, BookOpen, Database, Globe2, HardDrive, History, Search, Settings, Users } from "lucide-react";
import Link from "next/link";
import { LibraryBig } from "lucide-react";
import { headers } from "next/headers";
import { LocalDateTime } from "@/components/LocalDateTime";
import { AdminFrame } from "./AdminFrame";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminBookStats } from "@/lib/admin-books";
import { listAdminLoginRecords } from "@/lib/admin-login-records";
import { getContentSearchDb } from "@/lib/content-search-db";
import { getContentSearchIndexSummary } from "@/lib/content-search-index";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export default async function AdminPage() {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  const stats = getAdminBookStats();
  const indexStats = getContentSearchIndexSummary(getDb(), getContentSearchDb());
  const loginRecords = listAdminLoginRecords();

  return (
    <AdminFrame active="home">
      <section className="adminHome">
        <div className="adminStats" aria-label="后台概览">
          <div className="adminStatCard">
            <BookOpen size={20} aria-hidden="true" />
            <span>小说总数</span>
            <strong>{stats.totalBooks}</strong>
          </div>
          <div className="adminStatCard">
            <Database size={20} aria-hidden="true" />
            <span>已建索引</span>
            <strong>{indexStats.indexedBooks}</strong>
          </div>
          <div className="adminStatCard">
            <HardDrive size={20} aria-hidden="true" />
            <span>书库体积</span>
            <strong>{formatBytes(stats.totalSizeBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <Search size={20} aria-hidden="true" />
            <span>索引库</span>
            <strong>{formatBytes(indexStats.databaseBytes)}</strong>
          </div>
          <div className="adminStatCard">
            <Database size={20} aria-hidden="true" />
            <span>待更新</span>
            <strong>{indexStats.pendingBooks}</strong>
          </div>
          <div className="adminStatCard">
            <Globe2 size={20} aria-hidden="true" />
            <span>当前登录 IP</span>
            <strong title={access.clientIp}>{access.clientIp}</strong>
          </div>
        </div>

        <div className="adminHomeGrid">
          <Link className="adminHomeLink" href="/admin/books">
            <BookOpen size={19} aria-hidden="true" />
            <span>
              <strong>小说管理</strong>
              <small>添加、搜索、排序和批量删除小说</small>
            </span>
          </Link>
          <Link className="adminHomeLink" href="/admin/settings">
            <Settings size={19} aria-hidden="true" />
            <span>
              <strong>系统设置</strong>
              <small>站点名称、访问规则和后台偏好</small>
            </span>
          </Link>
          <Link className="adminHomeLink" href="/admin/media">
            <LibraryBig size={19} aria-hidden="true" />
            <span>
              <strong>资源管理</strong>
              <small>上传和维护视频、音频与文件</small>
            </span>
          </Link>
          <Link className="adminHomeLink" href="/admin/indexes">
            <Search size={19} aria-hidden="true" />
            <span>
              <strong>搜索索引</strong>
              <small>构建和维护 FTS5 全文索引</small>
            </span>
          </Link>
          <Link className="adminHomeLink" href="/admin/users">
            <Users size={19} aria-hidden="true" />
            <span>
              <strong>用户管理</strong>
              <small>维护前台用户、登录记录和搜索限速</small>
            </span>
          </Link>
          <Link className="adminHomeLink" href="/admin/analytics">
            <BarChart3 size={19} aria-hidden="true" />
            <span>
              <strong>数据分析</strong>
              <small>查看访问量、来源、设备和实时事件</small>
            </span>
          </Link>
        </div>

        <div className="adminPaths adminHomePaths">
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

        <section className="adminLoginAudit">
          <div className="adminPanelHeader">
            <div>
              <h2>登录记录</h2>
              <p>当前登录 IP：{access.clientIp}</p>
            </div>
            <History size={20} aria-hidden="true" />
          </div>
          <div className="adminTableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>IP</th>
                  <th>客户端</th>
                </tr>
              </thead>
              <tbody>
                {loginRecords.length ? (
                  loginRecords.map((record) => (
                    <tr key={`${record.loggedAt}-${record.ip}`}>
                      <td>
                        <LocalDateTime value={record.loggedAt} />
                      </td>
                      <td>{record.username}</td>
                      <td title={record.ip}>{record.ip}</td>
                      <td title={record.userAgent}>{record.userAgent || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>暂无登录记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </AdminFrame>
  );
}
