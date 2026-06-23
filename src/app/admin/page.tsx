import type { Metadata } from "next";
import { BookOpen, Database, HardDrive, Settings } from "lucide-react";
import Link from "next/link";
import { AdminFrame } from "./AdminFrame";
import { getAdminBookStats } from "@/lib/admin-books";

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

export default function AdminPage() {
  const stats = getAdminBookStats();

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
            <strong>{stats.indexedBooks}</strong>
          </div>
          <div className="adminStatCard">
            <HardDrive size={20} aria-hidden="true" />
            <span>书库体积</span>
            <strong>{formatBytes(stats.totalSizeBytes)}</strong>
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
      </section>
    </AdminFrame>
  );
}
