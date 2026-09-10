"use client";

import { usePathname } from "next/navigation";
import { AdminMobileNavigation } from "@/components/AdminNavigation";
import { AdminMessageLink } from "@/components/AdminMessageLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { adminNavKeyForPathname, adminTitleFor } from "@/lib/admin-navigation";

type AdminLogoutAction = () => void | Promise<void>;

export function AdminRouteTopbar({
  unreadMessages,
  logoutAction,
}: {
  unreadMessages: number;
  logoutAction: AdminLogoutAction;
}) {
  const active = adminNavKeyForPathname(usePathname());

  return (
    <header className="adminTopbar">
      <div className="adminTitleBlock">
        <h1>{adminTitleFor(active)}</h1>
      </div>
      <div className="adminTopActions">
        <AdminMessageLink unreadCount={unreadMessages} active={active === "station"} />
        <ThemeToggle />
        <AdminMobileNavigation logoutAction={logoutAction} />
      </div>
    </header>
  );
}
