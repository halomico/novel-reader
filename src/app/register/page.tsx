import type { Metadata } from "next";
import Link from "@/components/LocalizedLink";
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
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: uiText(await getRequestLocale(), "注册"), robots: NO_INDEX_ROBOTS };
}

type RegisterPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
    returnTo?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const params = await searchParams;
  const returnTo = normalizeUserReturnPath(params.returnTo);
  if (user) {
    redirect(withLocalePath(returnTo, locale));
  }
  const loginEnabled = isUserLoginEnabled();
  const registrationEnabled = isUserRegistrationEnabled();
  const turnstileSiteKey = getTurnstileSiteKey();
  const noticeDisplaySeconds = getNoticeDisplaySeconds();

  return (
    <main className="appShell">
      <SiteHeader currentUser={null} showPrimaryNavigation={false} authMode />
      <Breadcrumbs items={[{ label: uiText(locale, "首页"), href: "/" }, { label: uiText(locale, "注册") }]} />
      {params.notice ? (
        <DismissibleNotice
          message={await localizeText(params.notice, locale)}
          tone={params.tone}
          variant="search"
          displaySeconds={noticeDisplaySeconds}
        />
      ) : null}
      <section className="authPage">
        <form className="userPanel authPanel" action={registerUserAction}>
          <input name="returnTo" type="hidden" value={returnTo} />
          <div className="userPanelHeader"><div><h1>{uiText(locale, "注册")}</h1></div></div>
          <label>
            <span>{uiText(locale, "用户名")}</span>
            <input name="username" autoComplete="username" minLength={3} maxLength={32} disabled={!registrationEnabled} required />
          </label>
          <label>
            <span>{uiText(locale, "显示名称")}</span>
            <input name="displayName" maxLength={40} placeholder={uiText(locale, "可留空，默认使用用户名")} disabled={!registrationEnabled} />
          </label>
          <label>
            <span>{uiText(locale, "密码")}</span>
            <input name="password" type="password" autoComplete="new-password" minLength={6} maxLength={72} disabled={!registrationEnabled} required />
          </label>
          <label>
            <span>{uiText(locale, "确认密码")}</span>
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
            {uiText(locale, "注册")}
          </button>
          {!registrationEnabled ? <p className="authHint">{uiText(locale, "注册暂未开放。")}</p> : null}
          {loginEnabled ? (
            <p className="authSwitchText">
              {uiText(locale, "已有账号？")}<Link href={`/login?${new URLSearchParams({ returnTo }).toString()}`}>{uiText(locale, "去登录")}</Link>
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
