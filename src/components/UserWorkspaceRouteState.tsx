"use client";

import { Activity, FileText, MessageCircle, Settings, Sparkles, Store, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "@/components/LocalizedLink";
import { PageContextBar } from "@/components/PageContextBar";
import { stripLocalePath, uiText, type AppLocale } from "@/lib/locale";
import type { UserWorkspaceKey } from "./UserWorkspace";

export const WORKSPACE_MESSAGES_READ_EVENT = "novel:messages-read";

const NAV_ITEMS = [
  { key: "profile", href: "/account", label: "账户", icon: UserRound },
  { key: "growth", href: "/account?view=growth", label: "成长", icon: Sparkles },
  { key: "activity", href: "/activity", label: "动态", icon: Activity },
  { key: "messages", href: "/messages", label: "消息", icon: MessageCircle },
  { key: "market", href: "/market", label: "集市", icon: Store },
  { key: "articles", href: "/original/mine", label: "文章", icon: FileText },
  { key: "settings", href: "/settings", label: "设置", icon: Settings },
] as const;

function routeKey(pathname: string, searchParams: URLSearchParams): UserWorkspaceKey {
  if (pathname === "/account") return searchParams.get("view") === "growth" ? "growth" : "profile";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/messages")) return "messages";
  if (pathname.startsWith("/market")) return "market";
  if (pathname.startsWith("/original/mine")) return "articles";
  return "settings";
}

export function UserWorkspaceContext({ locale }: {
  locale: AppLocale;
}) {
  const { pathname, searchParams } = useWorkspaceRouteState();
  const active = routeKey(pathname, searchParams);
  const labels: Record<UserWorkspaceKey, string> = {
    profile: uiText(locale, "账户"),
    growth: uiText(locale, "成长"),
    activity: uiText(locale, "动态"),
    messages: uiText(locale, "消息"),
    market: uiText(locale, "集市"),
    articles: uiText(locale, "文章"),
    settings: uiText(locale, "设置"),
  };

  return <PageContextBar items={[{ label: uiText(locale, "首页"), href: "/" }, { label: labels[active] }]} />;
}

export function UserWorkspaceNavigation({
  locale,
  unreadMessages,
  showMarket,
  showOriginal,
}: {
  locale: AppLocale;
  unreadMessages: number;
  showMarket: boolean;
  showOriginal: boolean;
}) {
  const { pathname, searchParams } = useWorkspaceRouteState();
  const active = routeKey(pathname, searchParams);
  const pathKey = `${pathname}?${searchParams.toString()}`;
  const [prevPathKey, setPrevPathKey] = useState(pathKey);
  const [pendingActive, setPendingActive] = useState<UserWorkspaceKey | null>(null);
  const [prevUnreadMessages, setPrevUnreadMessages] = useState(unreadMessages);
  const [unreadCount, setUnreadCount] = useState(unreadMessages);

  if (prevPathKey !== pathKey) {
    setPrevPathKey(pathKey);
    setPendingActive(null);
  }

  if (prevUnreadMessages !== unreadMessages) {
    setPrevUnreadMessages(unreadMessages);
    setUnreadCount(unreadMessages);
  }

  useEffect(() => {
    const markRead = () => setUnreadCount(0);
    window.addEventListener(WORKSPACE_MESSAGES_READ_EVENT, markRead);
    return () => window.removeEventListener(WORKSPACE_MESSAGES_READ_EVENT, markRead);
  }, []);

  const currentActive = pendingActive ?? active;

  return (
    <nav>
      {NAV_ITEMS.filter((item) => (item.key !== "market" || showMarket) && (item.key !== "articles" || showOriginal)).map((item) => {
        const Icon = item.icon;
        const itemActive = currentActive === item.key;
        return (
          <Link
            className={itemActive ? "isActive" : ""}
            href={item.href}
            prefetch
            aria-current={itemActive ? "page" : undefined}
            key={item.key}
            onClick={() => {
              if (item.key !== active) {
                setPendingActive(item.key);
              }
            }}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{uiText(locale, item.label)}</span>
            {item.key === "messages" && unreadCount > 0 ? (
              <i className="userMenuUnreadDot" aria-label={`${unreadCount} 条未读消息`} />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function useWorkspaceRouteState() {
  // Keep pathname/query-derived chrome in a small client island so the server
  // layout can stay mounted while only the active state changes.
  const pathname = stripLocalePath(usePathname() || "/");
  const searchParams = new URLSearchParams(useSearchParams().toString());
  return { pathname, searchParams };
}
