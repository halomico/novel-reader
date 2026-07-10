import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { loginAdminAction } from "../actions";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession, isAdminSecurityConfigured } from "@/lib/admin-auth";
import { getNoticeDisplaySeconds, getSiteName, shouldNoticeStayVisibleAfterBlur } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminLoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    notFound();
  }

  const session = await getAdminSession();
  if (session) {
    redirect("/admin");
  }

  const params = await searchParams;
  const siteName = getSiteName();
  const configured = isAdminSecurityConfigured();
  const error = params.error || "";
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  return (
    <main className="adminLoginShell">
      <section className="adminLoginPanel">
        <div className="adminLoginBrand">
          <span className="adminLogo" aria-hidden="true">
            <LockKeyhole size={24} />
          </span>
          <div>
            <p>{siteName}</p>
            <h1>后台管理</h1>
          </div>
        </div>

        {!configured ? (
          <DismissibleNotice
            message="请先在 .env 配置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256，以及 ADMIN_SESSION_SECRET。"
            tone="warning"
            variant="admin"
            displaySeconds={noticeDisplaySeconds}
            stayVisibleAfterBlur={noticeStayVisibleAfterBlur}
          />
        ) : null}
        {error ? (
          <DismissibleNotice
            message={error}
            tone="error"
            variant="admin"
            displaySeconds={noticeDisplaySeconds}
            stayVisibleAfterBlur={noticeStayVisibleAfterBlur}
          />
        ) : null}

        <form className="adminLoginForm" action={loginAdminAction}>
          <label>
            <span>用户名</span>
            <input name="username" autoComplete="username" disabled={!configured} />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autoComplete="current-password" disabled={!configured} />
          </label>
          <button type="submit" disabled={!configured}>
            登录
          </button>
        </form>

        <Link className="adminBackHome" href="/">
          返回前台
        </Link>
      </section>
    </main>
  );
}
