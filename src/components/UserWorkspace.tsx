import { Activity, Cookie, CupSoda, FileText, LogOut, MessageCircle, Settings, Sparkles, Store, UserRound } from "lucide-react";
import Link from "@/components/LocalizedLink";
import { logoutUserAction } from "@/app/account/actions";
import type { UserProfile } from "@/lib/users";
import { uiText } from "@/lib/locale";
import { getRequestLocale } from "@/lib/locale-server";
import { countUserUnreadMessages } from "@/lib/station";
import { getUserLevelDefinition } from "@/lib/user-levels";
import { hasUserPermission } from "@/lib/user-levels";
import { isMarketEnabled, isOriginalChannelEntryVisible } from "@/lib/config";
import { PageContextBar } from "./PageContextBar";
import { SiteHeader } from "./SiteHeader";
import { UserAvatar } from "./UserAvatar";

export type UserWorkspaceKey = "profile" | "growth" | "activity" | "messages" | "market" | "articles" | "settings";

const NAV_ITEMS = [
  { key: "profile", href: "/account", label: "账户", icon: UserRound },
  { key: "growth", href: "/account?view=growth", label: "成长", icon: Sparkles },
  { key: "activity", href: "/activity", label: "动态", icon: Activity },
  { key: "messages", href: "/messages", label: "消息", icon: MessageCircle },
  { key: "market", href: "/market", label: "集市", icon: Store },
  { key: "articles", href: "/original/mine", label: "文章", icon: FileText },
  { key: "settings", href: "/settings", label: "设置", icon: Settings },
] as const;

export async function UserWorkspace({
  user,
  active,
  breadcrumb,
  mobileImmersive = false,
  children,
}: {
  user: UserProfile;
  active: UserWorkspaceKey;
  breadcrumb: string;
  mobileImmersive?: boolean;
  children: React.ReactNode;
}) {
  const locale = await getRequestLocale();
  const unreadMessages = countUserUnreadMessages(user.id);
  const level = getUserLevelDefinition(user.trustLevel);
  const showMarket = isMarketEnabled() && hasUserPermission(user, "market_access");
  const showOriginal = isOriginalChannelEntryVisible(true);

  return (
    <main className={`appShell userWorkspaceShell${mobileImmersive ? " isMobileImmersive" : ""}`}>
      <SiteHeader currentUser={user} unreadMessages={unreadMessages} />
      <PageContextBar items={[{ label: uiText(locale, "首页"), href: "/" }, { label: breadcrumb }]} />
      <section className="userWorkspaceLayout">
        <aside className="userWorkspaceSidebar" aria-label={uiText(locale, "账户")}>
          <div className="userWorkspaceIdentity">
            <UserAvatar className="userWorkspaceAvatar" userId={user.id} displayName={user.displayName} avatarPath={user.avatarPath} />
            <span>
              <strong>{user.displayName}</strong>
              <span className="userWorkspaceGrowth">
                <small title={level.name}><Sparkles size={12} aria-hidden="true" />Lv.{user.trustLevel}</small>
                <small title="苏打余额"><CupSoda size={12} aria-hidden="true" />{user.sodaBalance}</small>
                <small title="曲奇余额"><Cookie size={12} aria-hidden="true" />{user.cookieBalance}</small>
              </span>
            </span>
          </div>
          <nav>
            {NAV_ITEMS.filter((item) => (item.key !== "market" || showMarket) && (item.key !== "articles" || showOriginal)).map((item) => {
              const Icon = item.icon;
              return (
                <Link className={active === item.key ? "isActive" : ""} href={item.href} prefetch={active !== item.key} key={item.key}>
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
