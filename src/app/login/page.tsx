import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { HumanVerificationField } from "@/components/HumanVerificationField";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getNoticeDisplaySeconds,
  isUserLoginEnabled,
  isUserRegistrationEnabled,
} from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { getTurnstileSiteKey } from "@/lib/human-verification";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { normalizeUserReturnPath } from "@/lib/return-path";
import { loginUserAction } from "../account/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "登录", robots: NO_INDEX_ROBOTS };

type LoginPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
    username?: string;
    remember?: string;
    returnTo?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const returnTo = normalizeUserReturnPath(params.returnTo);
  if (user) {
    redirect(returnTo);
  }
  const loginEnabled = isUserLoginEnabled();
  const registrationEnabled = isUserRegistrationEnabled();
  const turnstileSiteKey = getTurnstileSiteKey();
  const noticeDisplaySeconds = getNoticeDisplaySeconds();

  return (
    <main className="appShell">
      <SiteHeader currentUser={null} showPrimaryNavigation={false} authMode />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "登录" }]} />
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={noticeDisplaySeconds}
        />
      ) : null}
      <section className="authPage">
        <form className="userPanel authPanel" action={loginUserAction}>
          <input name="returnTo" type="hidden" value={returnTo} />
          <div className="userPanelHeader"><div><h1>登录</h1></div></div>
          <label>
            <span>用户名</span>
            <input name="username" autoComplete="username" defaultValue={String(params.username || "").slice(0, 32)} disabled={!loginEnabled} required />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autoComplete="current-password" disabled={!loginEnabled} required />
          </label>
          <label className="authRemember">
            <input name="rememberLogin" type="checkbox" defaultChecked={params.remember !== "0"} />
            <span>保持登录状态</span>
          </label>
          <HumanVerificationField siteKey={turnstileSiteKey} purpose="login" />
          <button className="authPrimaryButton" type="submit" disabled={!loginEnabled}>
            登录
          </button>
          {!loginEnabled ? <p className="authHint">登录暂未开放。</p> : null}
          {registrationEnabled ? (
            <p className="authSwitchText">
              还没有账号？<Link href={`/register?${new URLSearchParams({ returnTo }).toString()}`}>去注册</Link>
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
