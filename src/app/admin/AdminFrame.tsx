import { BookOpen, LogOut, Search, Settings, Users } from "lucide-react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AdminMobileNavigation,
  AdminSidebarNavigation,
  type AdminNavKey,
} from "@/components/AdminNavigation";
import { AdminMessageLink } from "@/components/AdminMessageLink";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getNoticeDisplaySeconds, getSiteName } from "@/lib/config";
import { countAdminUnreadMessages } from "@/lib/station";
import { logoutAdminAction } from "./actions";

type AdminFrameProps = {
  active: AdminNavKey;
  notice?: string;
  tone?: "success" | "warning" | "error";
  breadcrumbs?: BreadcrumbItem[];
  mobileImmersive?: boolean;
  children: React.ReactNode;
};

function titleFor(active: AdminFrameProps["active"]): string {
  if (active === "home") {
    return "后台首页";
  }
  if (active === "books") {
    return "小说管理";
  }
  if (active === "indexes") {
    return "搜索索引";
  }
  if (active === "tags") {
    return "标签管理";
  }
  if (active === "access") {
    return "内容访问";
  }
  if (active === "station") {
    return "站务中心";
  }
  if (active === "users") {
    return "用户管理";
  }
  if (active === "analytics") {
    return "数据分析";
  }
  if (active === "media") {
    return "资源管理";
  }
  if (active === "market") {
    return "集市管理";
  }
  return "系统设置";
}

export async function AdminFrame({
  active,
  notice = "",
  tone,
  breadcrumbs,
  mobileImmersive = false,
  children,
}: AdminFrameProps) {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    notFound();
  }

  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const siteName = getSiteName();
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const unreadMessages = active === "station" ? 0 : countAdminUnreadMessages();
  const trail = breadcrumbs ?? (active === "home" ? [] : [{ label: titleFor(active) }]);
  const breadcrumbItems: BreadcrumbItem[] = [
    trail.length ? { label: "后台", href: "/admin" } : { label: "后台" },
    ...trail,
  ];

  return (
    <main className={`adminShell adminLayout${mobileImmersive ? " isMobileImmersive" : ""}`}>
      <AdminSidebarNavigation active={active} siteName={siteName} logoutAction={logoutAdminAction} />

      <section className="adminMain">
        <header className="adminTopbar">
          <div className="adminTitleBlock">
            <h1>{titleFor(active)}</h1>
          </div>
          <div className="adminTopActions">
            <AdminMessageLink unreadCount={unreadMessages} active={active === "station"} />
            <ThemeToggle />
            <AdminMobileNavigation active={active} logoutAction={logoutAdminAction} />
          </div>
        </header>
        <Breadcrumbs className="adminBreadcrumbs" items={breadcrumbItems} />
        {notice ? (
          <DismissibleNotice
            message={notice}
            tone={tone}
            variant="admin"
            displaySeconds={noticeDisplaySeconds}
          />
        ) : null}
        {children}
      </section>
    </main>
  );
}
