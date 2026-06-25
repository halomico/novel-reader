import { KeyRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, isUserLoginEnabled, isUserRegistrationEnabled, shouldNoticeStayVisibleAfterBlur } from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { loginUserAction } from "../account/actions";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
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
        <form className="userPanel authPanel" action={loginUserAction}>
          <div className="userPanelHeader">
            <KeyRound size={20} aria-hidden="true" />
            <div>
              <h1>用户登录</h1>
              <p>登录后可保留浏览记录，并使用独立搜索限速。</p>
            </div>
          </div>
          <label>
            <span>用户名</span>
            <input name="username" autoComplete="username" disabled={!loginEnabled} required />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autoComplete="current-password" disabled={!loginEnabled} required />
          </label>
          <button className="authPrimaryButton" type="submit" disabled={!loginEnabled}>
            登录
          </button>
          {!loginEnabled ? <p className="authHint">登录暂未开放。</p> : null}
          {registrationEnabled ? (
            <p className="authSwitchText">
              还没有账号？<Link href="/register">去注册</Link>
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
