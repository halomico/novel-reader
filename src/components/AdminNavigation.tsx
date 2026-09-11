"use client";

import {
  BarChart3,
  BookOpen,
  FilePenLine,
  House,
  LibraryBig,
  LogOut,
  Menu,
  ChevronLeft,
  ChevronRight,
  Search,
  ShieldCheck,
  MessagesSquare,
  Settings,
  Store,
  Tags,
  Users,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { adminNavKeyForPathname } from "@/lib/admin-navigation";
import { ADMIN_SIDEBAR_STORAGE_KEY } from "@/lib/ui-preferences";

export type { AdminNavKey } from "@/lib/admin-navigation";

const navItems = [
  { href: "/admin", label: "后台首页", value: "home", icon: House },
  { href: "/admin/books", label: "小说管理", value: "books", icon: BookOpen },
  { href: "/admin/tags", label: "标签管理", value: "tags", icon: Tags },
  { href: "/admin/original", label: "原创管理", value: "original", icon: FilePenLine },
  { href: "/admin/access", label: "内容访问", value: "access", icon: ShieldCheck },
  { href: "/admin/station", label: "站务中心", value: "station", icon: MessagesSquare },
  { href: "/admin/media", label: "资源管理", value: "media", icon: LibraryBig },
  { href: "/admin/market", label: "集市管理", value: "market", icon: Store },
  { href: "/admin/indexes", label: "搜索索引", value: "indexes", icon: Search },
  { href: "/admin/users", label: "用户管理", value: "users", icon: Users },
  { href: "/admin/analytics", label: "数据分析", value: "analytics", icon: BarChart3 },
  { href: "/admin/settings", label: "系统设置", value: "settings", icon: Settings },
] as const;

/** Marks its link while the destination is loading; rendered inside the link. */
function AdminNavLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span data-pending={pending || undefined}>{label}</span>;
}

function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  // The highlight follows the committed URL only. Click feedback comes from each
  // link's own pending status, so an interrupted or superseded navigation can never
  // leave a stale item highlighted next to a different page.
  const active = adminNavKeyForPathname(pathname);
  const intentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (intentTimerRef.current) clearTimeout(intentTimerRef.current);
  }, []);

  // Admin pages are dynamic and data heavy: prefetch the one the pointer rests
  // on instead of rendering every section whenever the sidebar is visible.
  function cancelIntentPrefetch() {
    if (intentTimerRef.current) clearTimeout(intentTimerRef.current);
    intentTimerRef.current = null;
  }

  function scheduleIntentPrefetch(href: string) {
    cancelIntentPrefetch();
    if (href === pathname) return;
    intentTimerRef.current = setTimeout(() => {
      intentTimerRef.current = null;
      router.prefetch(href);
    }, 60);
  }

  return (
    <nav className="adminSideNav" aria-label="后台导航">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isItemActive = item.value === active;
        return (
          <Link
            className={isItemActive ? "isActive" : ""}
            href={item.href}
            key={item.value}
            title={item.label}
            aria-current={isItemActive ? "page" : undefined}
            prefetch={false}
            onPointerEnter={() => scheduleIntentPrefetch(item.href)}
            onPointerLeave={cancelIntentPrefetch}
            onFocus={() => scheduleIntentPrefetch(item.href)}
            onPointerDown={() => {
              cancelIntentPrefetch();
              if (item.href !== pathname) router.prefetch(item.href);
            }}
            onClick={onNavigate}
          >
            <Icon size={18} aria-hidden="true" />
            <AdminNavLabel label={item.label} />
          </Link>
        );
      })}
    </nav>
  );
}

type AdminLogoutAction = () => void | Promise<void>;

export function AdminSidebarNavigation({
  siteName,
  logoutAction,
}: {
  siteName: string;
  logoutAction: AdminLogoutAction;
}) {
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
          <span>{siteName}</span>
        </Link>
      </div>
      <AdminNavLinks />
      <div className="adminSidebarFooter">
        <form action={logoutAction}>
          <button className="adminSidebarLogout" type="submit" title="退出登录">
            <LogOut size={18} aria-hidden="true" />
            <span>退出登录</span>
          </button>
        </form>
        <button
          className="adminSidebarToggle"
          type="button"
          aria-label={collapsed ? "展开后台菜单" : "收起后台菜单"}
          title={collapsed ? "展开菜单" : "收起菜单"}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
        </button>
      </div>
    </aside>
  );
}

export function AdminMobileNavigation({ logoutAction }: { logoutAction: AdminLogoutAction }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className="adminMobileMenu"
      ref={menuRef}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        className="iconLink"
        type="button"
        aria-label={open ? "关闭后台菜单" : "打开后台菜单"}
        aria-expanded={open}
        title="后台菜单"
        onClick={() => setOpen((current) => !current)}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div className="adminMobileMenuPanel">
          <AdminNavLinks onNavigate={() => setOpen(false)} />
          <form action={logoutAction}>
            <button className="adminMobileLogout" type="submit">
              <LogOut size={18} aria-hidden="true" />
              <span>退出登录</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
