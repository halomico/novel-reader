import { UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, isUserLoginEnabled, isUserRegistrationEnabled, shouldNoticeStayVisibleAfterBlur } from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { registerUserAction } from "../account/actions";

export const dynamic = "force-dynamic";

type RegisterPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/account");
  }

  const params = await searchParams;
  const loginEnabled = isUserLoginEnabled();
  const registrationEnabled = isUserRegistrationEnabled();
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  return (
    <main className="appShell">
      <SiteHeader />
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={noticeDisplaySeconds}
          stayVisibleAfterBlur={noticeStayVisibleAfterBlur}
        />
      ) : null}
      <section className="authPage">
        <form className="userPanel authPanel" action={registerUserAction}>
          <div className="userPanelHeader">
            <UserPlus size={20} aria-hidden="true" />
            <div>
              <h1>注册账号</h1>
              <p>用户名支持英文、数字、下划线和短横线。</p>
            </div>
          </div>
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
          <button className="authPrimaryButton" type="submit" disabled={!registrationEnabled}>
            注册并登录
          </button>
          {!registrationEnabled ? <p className="authHint">注册暂未开放。</p> : null}
          {loginEnabled ? (
            <p className="authSwitchText">
              已有账号？<Link href="/login">去登录</Link>
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
