import { Check, CupSoda, History, KeyRound, Save, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "@/components/LocalizedLink";
import { AvatarUploadForm } from "@/components/AvatarUploadForm";
import { CheckinLeaderboardDialog } from "@/components/CheckinLeaderboardDialog";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { UserWorkspace, type UserWorkspaceKey } from "@/components/UserWorkspace";
import { UserEntitlementList } from "@/components/UserEntitlementList";
import { Pagination } from "@/components/Pagination";
import { listUserEntitlementsPage } from "@/lib/entitlements";
import { getNoticeDisplaySeconds, getUserAvatarMaxBytes } from "@/lib/config";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import {
  getDailyCheckinState,
  listDailyCheckinLeaderboard,
  listCurrencyTransactionsPage,
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
    rightsPage?: string;
    sodaPage?: string;
    recordPage?: string;
    panel?: string;
  }>;
};

function resolveView(value: string | undefined): Extract<UserWorkspaceKey, "profile" | "growth"> {
  return value === "growth" ? "growth" : "profile";
}

function resolveGrowthPanel(value: string | undefined): "rights" | "record" | "" {
  if (value === "rights") return "rights";
  return value === "record" || value === "soda" ? "record" : "";
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
  const growthPanel = view === "growth" ? resolveGrowthPanel(params.panel) : "";
  const maxAvatarMb = (getUserAvatarMaxBytes() / 1024 / 1024).toFixed(1);
  const growth = getUserGrowthProgress(user.sodaExperience);
  const level = growth.current;
  const checkin = view === "growth" ? getDailyCheckinState(user.id) : null;
  const transactions = view === "growth"
    ? listCurrencyTransactionsPage(user.id, Number(params.recordPage || params.sodaPage || 1), 10)
    : null;
  const entitlements = view === "growth"
    ? listUserEntitlementsPage(user.id, { page: Number(params.rightsPage || 1), pageSize: 10 })
    : null;
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

          <nav className="accountGrowthTools" aria-label="成长明细">
            <Link
              className={growthPanel === "rights" ? "isActive" : ""}
              href={growthPanel === "rights" ? "/account?view=growth" : "/account?view=growth&panel=rights"}
              scroll={false}
              aria-label="权益"
            >
              <ShieldCheck size={18} aria-hidden="true" /><span>{tr("权益")}</span>
            </Link>
            <Link
              className={growthPanel === "record" ? "isActive" : ""}
              href={growthPanel === "record" ? "/account?view=growth" : "/account?view=growth&panel=record"}
              scroll={false}
              aria-label="记录"
            >
              <History size={18} aria-hidden="true" /><span>{tr("记录")}</span>
            </Link>
          </nav>

          {growthPanel === "rights" && entitlements ? (
            <section className="accountGrowthDetail accountRightsDetail" id="growth-detail">
              <div className="accountPermissionList" aria-label={tr("等级权益")}>
                {USER_PERMISSION_DEFINITIONS.filter((permission) => level.permissions.includes(permission.key)).map((permission) => (
                  <span className="isEnabled" key={permission.key}><Check size={13} aria-hidden="true" />{permissionLabels.get(permission.key) || permission.label}</span>
                ))}
              </div>
              <UserEntitlementList data={entitlements} locale={locale} />
            </section>
          ) : null}

          {growthPanel === "record" && transactions ? <section className="accountSodaHistory accountGrowthDetail" id="growth-detail">
            {transactions.items.length ? (
              <div>
                {transactions.items.map((item) => (
                  <article key={item.id}>
                    <span>
                      <strong>{item.note || item.source}<em>{item.currency === "cookie" ? tr("曲奇") : tr("苏打")}</em></strong>
                      <small>{new Date(item.createdAt).toLocaleString(locale === "zh-Hant" ? "zh-TW" : "zh-CN", { hour12: false })}</small>
                    </span>
                    <b className={item.amount > 0 ? "isPositive" : ""}>
                      {item.amount > 0 ? "+" : ""}{item.amount}
                    </b>
                  </article>
                ))}
              </div>
            ) : <p className="messageEmpty">{tr("暂无记录")}</p>}
            <Pagination
              page={transactions.page}
              totalPages={transactions.totalPages}
              query=""
              basePath="/account"
              pageParam="recordPage"
              extraParams={{ view: "growth", panel: "record" }}
            />
          </section> : null}
        </article>
      ) : null}
    </UserWorkspace>
  );
}
