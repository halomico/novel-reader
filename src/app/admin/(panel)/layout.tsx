import { redirect } from "next/navigation";
import { logoutAdminAction } from "@/app/admin/actions";
import { AdminSidebarNavigation } from "@/components/AdminNavigation";
import { AdminRouteTopbar } from "@/components/AdminRouteTopbar";
import { getAdminSession } from "@/lib/admin-auth";
import { getSiteName } from "@/lib/config";
import { database } from "@/core/db/postgres";
import { countPostgresAdminUnreadMessages } from "@/domains/station/postgres-station";
import "../../styles/routes/admin.css";

export const dynamic = "force-dynamic";

export default async function AdminPanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!await getAdminSession()) {
    redirect("/admin/login");
  }

  return (
    <main className="adminShell adminLayout">
      <AdminSidebarNavigation siteName={getSiteName()} logoutAction={logoutAdminAction} />
      <section className="adminMain">
        <AdminRouteTopbar unreadMessages={await countPostgresAdminUnreadMessages(database("web"))} logoutAction={logoutAdminAction} />
        {children}
      </section>
    </main>
  );
}
