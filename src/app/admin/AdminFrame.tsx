import { BookOpen, LogOut, Search, Settings, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getSiteName } from "@/lib/config";
import { logoutAdminAction } from "./actions";

type AdminFrameProps = {
  active: "home" | "books" | "indexes" | "settings";
  notice?: string;
  tone?: "success" | "warning" | "error";
  children: React.ReactNode;
};

const navItems = [
  { href: "/admin/books", label: "小说管理", value: "books", icon: BookOpen },
  { href: "/admin/indexes", label: "搜索索引", value: "indexes", icon: Search },
  { href: "/admin/settings", label: "系统设置", value: "settings", icon: Settings },
  { href: "#", label: "用户管理", value: "users", icon: Users, disabled: true },
];

function noticeClass(tone?: string) {
  if (tone === "error") {
    return "adminNotice isError";
  }
  if (tone === "warning") {
    return "adminNotice isWarning";
  }
  return "adminNotice isSuccess";
}

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
            const className = item.value === active ? "isActive" : item.disabled ? "isDisabled" : "";
            return item.disabled ? (
              <span className={className} key={item.value}>
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </span>
            ) : (
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
        {notice ? <p className={noticeClass(tone)}>{notice}</p> : null}
        {children}
      </section>
    </main>
  );
}
