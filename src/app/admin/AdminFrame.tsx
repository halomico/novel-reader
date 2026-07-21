import { BookOpen, LogOut, Search, Settings, Users } from "lucide-react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AdminMobileNavigation,
  AdminSidebarNavigation,
  type AdminNavKey,
} from "@/components/AdminNavigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getNoticeDisplaySeconds, getSiteName } from "@/lib/config";
import { logoutAdminAction } from "./actions";

type AdminFrameProps = {
  active: AdminNavKey;
  notice?: string;
  tone?: "success" | "warning" | "error";
  breadcrumbs?: BreadcrumbItem[];
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
  if (active === "reports") {
    return "内容举报";
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
  return "系统设置";
}

export async function AdminFrame({ active, notice = "", tone, breadcrumbs, children }: AdminFrameProps) {
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
  const trail = breadcrumbs ?? (active === "home" ? [] : [{ label: titleFor(active) }]);
  const breadcrumbItems: BreadcrumbItem[] = [
    trail.length ? { label: "后台", href: "/admin" } : { label: "后台" },
    ...trail,
  ];

  return (
    <main className="adminShell adminLayout">
      <AdminSidebarNavigation active={active} siteName={siteName} />

      <section className="adminMain">
        <Breadcrumbs className="adminBreadcrumbs" items={breadcrumbItems} />
        <header className="adminTopbar">
          <div className="adminTitleBlock">
            <h1>{titleFor(active)}</h1>
          </div>
          <div className="adminTopActions">
            <ThemeToggle />
            <form action={logoutAdminAction}>
              <button className="adminIconButton" type="submit" aria-label="退出登录" title="退出登录">
                <LogOut size={20} aria-hidden="true" />
              </button>
            </form>
            <AdminMobileNavigation active={active} />
          </div>
        </header>
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
