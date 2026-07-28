import { Activity, CupSoda, LogOut, MessageCircle, Settings, Sparkles, UserRound } from "lucide-react";
import Link from "@/components/LocalizedLink";
import { logoutUserAction } from "@/app/account/actions";
import type { UserProfile } from "@/lib/users";
import { uiText } from "@/lib/locale";
import { getRequestLocale } from "@/lib/locale-server";
import { countUserUnreadMessages } from "@/lib/station";
import { getUserLevelDefinition } from "@/lib/user-levels";
import { Breadcrumbs } from "./Breadcrumbs";
import { SiteHeader } from "./SiteHeader";

export type UserWorkspaceKey = "profile" | "growth" | "activity" | "messages" | "settings";

const NAV_ITEMS = [
  { key: "profile", href: "/account", label: "账户", icon: UserRound },
  { key: "growth", href: "/account?view=growth", label: "成长", icon: Sparkles },
  { key: "activity", href: "/activity", label: "动态", icon: Activity },
  { key: "messages", href: "/messages", label: "消息", icon: MessageCircle },
  { key: "settings", href: "/settings", label: "设置", icon: Settings },
] as const;

export async function UserWorkspace({
  user,
  active,
  breadcrumb,
  children,
}: {
  user: UserProfile;
  active: UserWorkspaceKey;
  breadcrumb: string;
  children: React.ReactNode;
}) {
  const locale = await getRequestLocale();
  const unreadMessages = countUserUnreadMessages(user.id);
  const level = getUserLevelDefinition(user.trustLevel);

  return (
    <main className="appShell userWorkspaceShell">
      <SiteHeader currentUser={user} unreadMessages={unreadMessages} />
      <Breadcrumbs items={[{ label: uiText(locale, "首页"), href: "/" }, { label: breadcrumb }]} />
      <section className="userWorkspaceLayout">
        <aside className="userWorkspaceSidebar" aria-label={uiText(locale, "账户")}>
          <div className="userWorkspaceIdentity">
            <span className="userWorkspaceAvatar" aria-hidden="true">
              {user.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={22} />}
            </span>
            <span>
              <strong>{user.displayName}</strong>
              <span className="userWorkspaceGrowth">
                <small title={level.name}><Sparkles size={12} aria-hidden="true" />Lv.{user.trustLevel}</small>
                <small title="苏打余额"><CupSoda size={12} aria-hidden="true" />{user.sodaBalance}</small>
              </span>
            </span>
          </div>
          <nav>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link className={active === item.key ? "isActive" : ""} href={item.href} key={item.key}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{uiText(locale, item.label)}</span>
                  {item.key === "messages" && unreadMessages > 0 ? (
                    <i className="userMenuUnreadDot" aria-label={`${unreadMessages} 条未读消息`} />
                  ) : null}
                </Link>
              );
            })}
          </nav>
          <form action={logoutUserAction}>
            <button type="submit">
              <LogOut size={17} aria-hidden="true" />
              <span>{uiText(locale, "退出")}</span>
            </button>
          </form>
        </aside>
        <div className="userWorkspaceContent">{children}</div>
      </section>
    </main>
  );
}
