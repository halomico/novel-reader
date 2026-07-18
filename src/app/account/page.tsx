import { KeyRound, Save, Settings, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { AvatarUploadForm } from "@/components/AvatarUploadForm";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, getUserAvatarMaxBytes, shouldNoticeStayVisibleAfterBlur } from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import {
  updateAccountDisplayNameAction,
  updateAccountPasswordAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "用户中心", robots: NO_INDEX_ROBOTS };

type AccountPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const maxAvatarMb = (getUserAvatarMaxBytes() / 1024 / 1024).toFixed(1);
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "账户" }]} />
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={noticeDisplaySeconds}
          stayVisibleAfterBlur={noticeStayVisibleAfterBlur}
        />
      ) : null}

      <section className="accountLayout">
        <input className="accountTabInput" id="account-tab-profile" name="accountTab" type="radio" defaultChecked />
        <input className="accountTabInput" id="account-tab-security" name="accountTab" type="radio" />
        <aside className="accountSideNav" aria-label="账户导航">
          <label htmlFor="account-tab-profile">
            <UserRound size={16} aria-hidden="true" />
            账户资料
          </label>
          <label htmlFor="account-tab-security">
            <KeyRound size={16} aria-hidden="true" />
            账户安全
          </label>
          <Link href="/settings">
            <Settings size={16} aria-hidden="true" />
            阅读设置
          </Link>
        </aside>

        <div className="accountContent">
          <article className="userPanel accountPanel accountProfile" id="profile">
            <div className="accountProfileHeader">
              <div className="accountAvatar" aria-hidden="true">
                {user.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={34} />}
              </div>
              <div className="accountIdentity">
                <h1>{user.displayName}</h1>
                <p>@{user.username}</p>
              </div>
              <AvatarUploadForm maxAvatarMb={maxAvatarMb} />
            </div>

            <form className="accountProfileForm" action={updateAccountDisplayNameAction}>
              <label>
                <span>显示名称</span>
                <input name="displayName" defaultValue={user.displayName} maxLength={40} required />
              </label>
              <button className="accountActionButton" type="submit"><Save size={15} aria-hidden="true" />保存</button>
            </form>
          </article>

          <article className="userPanel accountPanel accountSecurity" id="security">
            <div className="userPanelHeader">
              <KeyRound size={20} aria-hidden="true" />
              <div>
                <h2>账户安全</h2>
                <p>修改密码后，新密码会立即用于后续登录。</p>
              </div>
            </div>
            <form className="accountPasswordForm" action={updateAccountPasswordAction}>
              <label>
                <span>当前密码</span>
                <input name="currentPassword" type="password" autoComplete="current-password" required />
              </label>
              <label>
                <span>新密码</span>
                <input name="newPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required />
              </label>
              <label>
                <span>确认新密码</span>
                <input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required />
              </label>
              <button className="accountActionButton" type="submit"><Save size={15} aria-hidden="true" />更新</button>
            </form>
          </article>

        </div>
      </section>
    </main>
  );
}
