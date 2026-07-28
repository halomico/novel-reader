import { Check, CupSoda, KeyRound, Save, Sparkles, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AvatarUploadForm } from "@/components/AvatarUploadForm";
import { CheckinLeaderboardDialog } from "@/components/CheckinLeaderboardDialog";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { UserWorkspace, type UserWorkspaceKey } from "@/components/UserWorkspace";
import { getNoticeDisplaySeconds, getUserAvatarMaxBytes } from "@/lib/config";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import {
  getDailyCheckinState,
  listDailyCheckinLeaderboard,
  listSodaTransactions,
} from "@/lib/user-economy";
import { getUserGrowthProgress, USER_PERMISSION_DEFINITIONS } from "@/lib/user-levels";
import {
  claimDailySodaAction,
  updateAccountDisplayNameAction,
  updateAccountPasswordAction,
} from "./actions";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: uiText(await getRequestLocale(), "用户中心"), robots: NO_INDEX_ROBOTS };
}

type AccountPageProps = {
  searchParams: Promise<{
    view?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
    checkin?: string;
  }>;
};

function resolveView(value: string | undefined): Extract<UserWorkspaceKey, "profile" | "growth"> {
  return value === "growth" ? "growth" : "profile";
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const user = await getCurrentUser();
  if (!user) {
    redirect(withLocalePath("/login", locale));
  }

  const params = await searchParams;
  const view = resolveView(params.view);
  const maxAvatarMb = (getUserAvatarMaxBytes() / 1024 / 1024).toFixed(1);
  const growth = getUserGrowthProgress(user.sodaExperience);
  const level = growth.current;
  const checkin = view === "growth" ? getDailyCheckinState(user.id) : null;
  const transactions = view === "growth" ? listSodaTransactions(user.id, 12) : [];
  const showCheckinDialog = view === "growth" && params.checkin === "1" && Boolean(checkin?.checkedIn);
  const checkinLeaderboard = showCheckinDialog ? listDailyCheckinLeaderboard() : null;
  const labels: Record<typeof view, string> = {
    profile: tr("账户"),
    growth: tr("成长"),
  };
  const displayLevelName = await localizeText(level.name, locale);
  const displayNextLevelName = growth.next ? await localizeText(growth.next.name, locale) : "";
  const permissionLabels = new Map(
    await Promise.all(USER_PERMISSION_DEFINITIONS.map(async (permission) => [
      permission.key,
      await localizeText(permission.label, locale),
    ] as const)),
  );

  return (
    <UserWorkspace user={user} active={view} breadcrumb={labels[view]}>
      {params.notice && !showCheckinDialog ? (
        <DismissibleNotice
          message={await localizeText(params.notice, locale)}
          tone={params.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}

      {view === "profile" ? (
        <article className="userPanel accountPanel accountProfile">
          <div className="accountProfileHeader">
            <div className="accountAvatar" aria-hidden="true">
              {user.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={32} />}
            </div>
            <div className="accountIdentity">
              <h1>{user.displayName}</h1>
              <p>@{user.username}</p>
            </div>
            <AvatarUploadForm maxAvatarMb={maxAvatarMb} locale={locale} />
          </div>

          <div className="accountFormSections">
            <section className="accountFormSection">
              <header>
                <h2>{tr("资料")}</h2>
              </header>
              <form className="accountProfileForm" action={updateAccountDisplayNameAction}>
                <label>
                  <span>{tr("显示名称")}</span>
                  <input name="displayName" defaultValue={user.displayName} maxLength={40} required />
                </label>
                <button className="accountActionButton" type="submit"><Save size={14} aria-hidden="true" />{tr("保存")}</button>
              </form>
            </section>

            <section className="accountFormSection accountSecurity" id="account-security">
              <header>
                <KeyRound size={17} aria-hidden="true" />
                <div>
                  <h2>{tr("安全")}</h2>
                  <p>{tr("更新后，其他登录状态会自动失效。")}</p>
                </div>
              </header>
              <form className="accountPasswordForm" action={updateAccountPasswordAction}>
                <label>
                  <span>{tr("当前密码")}</span>
                  <input name="currentPassword" type="password" autoComplete="current-password" required />
                </label>
                <label>
                  <span>{tr("新密码")}</span>
                  <input name="newPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required />
                </label>
                <label>
                  <span>{tr("确认密码")}</span>
                  <input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required />
                </label>
                <button className="accountActionButton" type="submit"><Save size={14} aria-hidden="true" />{tr("更新")}</button>
              </form>
            </section>
          </div>
        </article>
      ) : null}

      {view === "growth" && checkin ? (
        <article className="userPanel accountPanel accountGrowth">
          <header className="accountGrowthHeader">
            <div>
              <span className="accountGrowthLevel"><Sparkles size={18} aria-hidden="true" />Lv.{user.trustLevel}</span>
              <h1>{displayLevelName}</h1>
            </div>
            <div className="accountGrowthBalance">
              <CupSoda size={18} aria-hidden="true" />
              <span>{tr("苏打")}</span>
              <strong>{user.sodaBalance}</strong>
            </div>
          </header>

          <section className="accountLevelProgress" aria-label={tr("等级进度")}>
            <header>
              <span>{tr("累计成长")}</span>
              <strong>
                {growth.next ? `${growth.currentValue} / ${growth.targetValue}` : `${growth.currentValue}`}
              </strong>
            </header>
            <div
              className="accountLevelProgressTrack"
              role="progressbar"
              aria-valuemin={growth.current.sodaRequired}
              aria-valuemax={growth.targetValue}
              aria-valuenow={Math.min(growth.currentValue, growth.targetValue)}
            >
              <span style={{ width: `${growth.progress}%` }} />
            </div>
            <footer>
              <span>Lv.{growth.current.level}</span>
              <span>{growth.next ? `Lv.${growth.next.level} · ${displayNextLevelName}` : tr("已达最高等级")}</span>
            </footer>
          </section>

          <div className="accountPermissionList" aria-label={tr("当前等级权限")}>
            {USER_PERMISSION_DEFINITIONS.filter((permission) => level.permissions.includes(permission.key)).map((permission) => (
              <span className="isEnabled" key={permission.key}>
                <Check size={13} aria-hidden="true" />
                {permissionLabels.get(permission.key) || permission.label}
              </span>
            ))}
          </div>

          <form className="accountCheckin" action={claimDailySodaAction}>
            <div className="accountCheckinCopy">
              <strong>{tr(checkin.checkedIn ? "今日已签到" : "每日签到")}</strong>
              <small>{checkin.checkedIn ? `${tr("获得")} ${checkin.reward} ${tr("苏打")}` : tr("今日份惊喜等你开启")}</small>
            </div>
            <div className="accountCheckinActions">
              <CheckinLeaderboardDialog
                reward={checkin.reward}
                currentUserId={user.id}
                entries={checkinLeaderboard}
                autoOpen={showCheckinDialog}
                locale={locale}
              />
              <button
                className="accountCheckinButton"
                type="submit"
                disabled={checkin.checkedIn}
                aria-label={tr(checkin.checkedIn ? "今日已签到" : "试试手气")}
                title={tr(checkin.checkedIn ? "今日已签到" : "试试手气")}
              >
                {tr(checkin.checkedIn ? "已签到" : "试试手气")}
              </button>
            </div>
          </form>

          <section className="accountSodaHistory">
            <h2>{tr("苏打记录")}</h2>
            {transactions.length ? (
              <div>
                {transactions.map((item) => (
                  <article key={item.id}>
                    <span>
                      <strong>{item.note || item.source}</strong>
                      <small>{new Date(item.createdAt).toLocaleString(locale === "zh-Hant" ? "zh-TW" : "zh-CN", { hour12: false })}</small>
                    </span>
                    <b className={item.amount > 0 ? "isPositive" : ""}>
                      {item.amount > 0 ? "+" : ""}{item.amount}
                    </b>
                  </article>
                ))}
              </div>
            ) : <p className="messageEmpty">{tr("暂无记录")}</p>}
          </section>
        </article>
      ) : null}
    </UserWorkspace>
  );
}
