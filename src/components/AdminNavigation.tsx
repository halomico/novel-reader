"use client";

import {
  BarChart3,
  BookOpen,
  House,
  LibraryBig,
  Menu,
  Flag,
  ChevronLeft,
  ChevronRight,
  Search,
  Settings,
  Tags,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ADMIN_SIDEBAR_STORAGE_KEY } from "@/lib/ui-preferences";

export type AdminNavKey = "home" | "books" | "indexes" | "settings" | "users" | "analytics" | "media" | "tags" | "reports";

const navItems = [
  { href: "/admin", label: "后台首页", value: "home", icon: House },
  { href: "/admin/books", label: "小说管理", value: "books", icon: BookOpen },
  { href: "/admin/tags", label: "标签管理", value: "tags", icon: Tags },
  { href: "/admin/reports", label: "内容举报", value: "reports", icon: Flag },
  { href: "/admin/media", label: "资源管理", value: "media", icon: LibraryBig },
  { href: "/admin/indexes", label: "搜索索引", value: "indexes", icon: Search },
  { href: "/admin/users", label: "用户管理", value: "users", icon: Users },
  { href: "/admin/analytics", label: "数据分析", value: "analytics", icon: BarChart3 },
  { href: "/admin/settings", label: "系统设置", value: "settings", icon: Settings },
] as const;

function AdminNavLinks({ active, onNavigate }: { active: AdminNavKey; onNavigate?: () => void }) {
  return (
    <nav className="adminSideNav" aria-label="后台导航">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            className={item.value === active ? "isActive" : ""}
            href={item.href}
            key={item.value}
            title={item.label}
            onClick={onNavigate}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSidebarNavigation({ active, siteName }: { active: AdminNavKey; siteName: string }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(document.documentElement.dataset.adminSidebar === "collapsed");
    } catch {
      setCollapsed(false);
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      document.documentElement.dataset.adminSidebar = next ? "collapsed" : "expanded";
      try {
        localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Sidebar persistence is optional.
      }
      return next;
    });
  }

  return (
    <aside className={collapsed ? "adminSidebar isCollapsed" : "adminSidebar"}>
      <div className="adminSidebarHeader">
        <Link className="adminBrandCompact" href="/admin" title={siteName}>
          <span className="adminLogo" aria-hidden="true">
            <BookOpen size={21} />
          </span>
          <span>{siteName}</span>
        </Link>
      </div>
      <AdminNavLinks active={active} />
      <button
        className="adminSidebarToggle"
        type="button"
        aria-label={collapsed ? "展开后台菜单" : "收起后台菜单"}
        title={collapsed ? "展开菜单" : "收起菜单"}
        onClick={toggleCollapsed}
      >
        {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
      </button>
    </aside>
  );
}

export function AdminMobileNavigation({ active }: { active: AdminNavKey }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="adminMobileMenu"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        className="adminIconButton"
        type="button"
        aria-label={open ? "关闭后台菜单" : "打开后台菜单"}
        aria-expanded={open}
        title="后台菜单"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      {open ? (
        <div className="adminMobileMenuPanel">
          <AdminNavLinks active={active} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
