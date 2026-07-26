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
import { registerUserAction } from "../account/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "注册", robots: NO_INDEX_ROBOTS };

type RegisterPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
    returnTo?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
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
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "注册" }]} />
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={noticeDisplaySeconds}
        />
      ) : null}
      <section className="authPage">
        <form className="userPanel authPanel" action={registerUserAction}>
          <input name="returnTo" type="hidden" value={returnTo} />
          <div className="userPanelHeader"><div><h1>注册</h1></div></div>
          <label>
            <span>用户名</span>
            <input name="username" autoComplete="username" minLength={3} maxLength={32} disabled={!registrationEnabled} required />
          </label>
          <label>
            <span>显示名称</span>
            <input name="displayName" maxLength={40} placeholder="可留空，默认使用用户名" disabled={!registrationEnabled} />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autoComplete="new-password" minLength={6} maxLength={72} disabled={!registrationEnabled} required />
          </label>
          <label>
            <span>确认密码</span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={6}
              maxLength={72}
              disabled={!registrationEnabled}
              required
            />
          </label>
          <HumanVerificationField siteKey={turnstileSiteKey} purpose="register" />
          <button className="authPrimaryButton" type="submit" disabled={!registrationEnabled}>
            注册
          </button>
          {!registrationEnabled ? <p className="authHint">注册暂未开放。</p> : null}
          {loginEnabled ? (
            <p className="authSwitchText">
              已有账号？<Link href={`/login?${new URLSearchParams({ returnTo }).toString()}`}>去登录</Link>
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
