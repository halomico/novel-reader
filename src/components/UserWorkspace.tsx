import { Cookie, CupSoda, LogOut, Sparkles } from "lucide-react";
import { logoutUserAction } from "@/app/account/actions";
import { database } from "@/core/db/postgres";
import { getPostgresUserLevelDefinition, hasPostgresUserPermission } from "@/domains/identity/postgres-permissions";
import type { PostgresUserProfile as UserProfile } from "@/domains/identity/postgres-users";
import { uiText } from "@/lib/locale";
import { getRequestLocale } from "@/lib/locale-server";
import { countPostgresUserUnreadMessages } from "@/domains/station/postgres-station";
import { isMarketEnabled, isOriginalChannelEntryVisible } from "@/lib/config";
import { SiteHeader } from "./SiteHeader";
import { UserAvatar } from "./UserAvatar";
import { UserWorkspaceContext, UserWorkspaceNavigation } from "./UserWorkspaceRouteState";

export type UserWorkspaceKey = "profile" | "growth" | "activity" | "messages" | "market" | "articles" | "settings";

export async function UserWorkspace({
  user,
  children,
}: {
  user: UserProfile;
  children: React.ReactNode;
}) {
  const locale = await getRequestLocale();
  const unreadMessages = await countPostgresUserUnreadMessages(database("web"), user.id);
  const level = await getPostgresUserLevelDefinition(database("web"), user.trustLevel);
  const showMarket = isMarketEnabled() && await hasPostgresUserPermission(database("web"), user, "market_access");
  const showOriginal = isOriginalChannelEntryVisible(true);

  return (
    <main className="appShell userWorkspaceShell">
      <SiteHeader currentUser={user} unreadMessages={unreadMessages} />
      <UserWorkspaceContext locale={locale} />
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
          <UserWorkspaceNavigation locale={locale} unreadMessages={unreadMessages} showMarket={showMarket} showOriginal={showOriginal} />
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
