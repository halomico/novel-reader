import { BookOpen, LogOut, Search, Settings, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getNoticeDisplaySeconds, getSiteName, shouldNoticeStayVisibleAfterBlur } from "@/lib/config";
import { logoutAdminAction } from "./actions";

type AdminFrameProps = {
  active: "home" | "books" | "indexes" | "settings" | "users" | "analytics";
  notice?: string;
  tone?: "success" | "warning" | "error";
  children: React.ReactNode;
};

const navItems = [
  { href: "/admin/books", label: "小说管理", value: "books", icon: BookOpen },
  { href: "/admin/indexes", label: "搜索索引", value: "indexes", icon: Search },
  { href: "/admin/users", label: "用户管理", value: "users", icon: Users },
  { href: "/admin/analytics", label: "数据分析", value: "analytics", icon: BarChart3 },
  { href: "/admin/settings", label: "系统设置", value: "settings", icon: Settings },
];

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
  if (active === "users") {
    return "用户管理";
  }
  if (active === "analytics") {
    return "数据分析";
  }
  return "系统设置";
}

export async function AdminFrame({ active, notice = "", tone, children }: AdminFrameProps) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  const siteName = getSiteName();
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  if (!access.allowed) {
    return (
      <main className="adminShell">
        <section className="adminForbidden">
          <ShieldCheck size={28} aria-hidden="true" />
          <h1>后台访问受限</h1>
          <p>{access.reason}</p>
          <form action={logoutAdminAction}>
            <button type="submit">退出登录</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="adminShell adminLayout">
      <aside className="adminSidebar">
        <Link className="adminBrandCompact" href="/admin">
          <span className="adminLogo" aria-hidden="true">
            <BookOpen size={22} />
          </span>
          <span>{siteName}</span>
        </Link>
        <nav className="adminSideNav" aria-label="后台导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const className = item.value === active ? "isActive" : "";
            return (
              <Link className={className} href={item.href} key={item.value}>
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="adminMain">
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
          </div>
        </header>
        {notice ? (
          <DismissibleNotice
            message={notice}
            tone={tone}
            variant="admin"
            displaySeconds={noticeDisplaySeconds}
            stayVisibleAfterBlur={noticeStayVisibleAfterBlur}
          />
        ) : null}
        {children}
      </section>
    </main>
  );
}
