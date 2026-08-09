import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds } from "@/lib/config";
import { verifyEmailToken } from "@/lib/email-verification";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { resendVerificationEmailAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "验证邮箱", robots: NO_INDEX_ROBOTS };

type VerifyEmailPageProps = {
  searchParams: Promise<{
    token?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  if (params.token) {
    const verified = verifyEmailToken(params.token);
    redirect(
      `/login?notice=${encodeURIComponent(verified ? "邮箱验证成功，现在可以登录" : "验证链接无效或已过期")}` +
      `&tone=${verified ? "success" : "warning"}`,
    );
  }
  const user = await getCurrentUser();
  if (user) redirect("/account");

  return (
    <main className="appShell">
      <SiteHeader currentUser={null} showPrimaryNavigation={false} authMode />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "验证邮箱" }]} />
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      <section className="authPage">
        <form className="userPanel authPanel verifyEmailPanel" action={resendVerificationEmailAction}>
          <span className="authPanelIcon"><MailCheck size={24} aria-hidden="true" /></span>
          <div className="userPanelHeader"><div><h1>验证邮箱</h1></div></div>
          <p className="authHint">验证链接 24 小时内有效。未收到时可重新发送。</p>
          <label>
            <span>邮箱</span>
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <button className="authPrimaryButton" type="submit">重新发送</button>
        </form>
      </section>
    </main>
  );
}
