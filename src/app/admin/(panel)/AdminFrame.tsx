import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { adminTitleFor, type AdminNavKey } from "@/lib/admin-navigation";
import { getNoticeDisplaySeconds } from "@/lib/config";

type AdminFrameProps = {
  active: AdminNavKey;
  notice?: string;
  tone?: "success" | "warning" | "error";
  breadcrumbs?: BreadcrumbItem[];
  mobileImmersive?: boolean;
  children: React.ReactNode;
};

export async function AdminFrame({
  active,
  notice = "",
  tone,
  breadcrumbs,
  mobileImmersive = false,
  children,
}: AdminFrameProps) {
  const access = getAdminAccessState(await headers());
  if (!access.allowed) {
    notFound();
  }
  if (!await getAdminSession()) {
    redirect("/admin/login");
  }

  const trail = breadcrumbs ?? (active === "home" ? [] : [{ label: adminTitleFor(active) }]);
  const breadcrumbItems: BreadcrumbItem[] = [
    trail.length ? { label: "后台", href: "/admin" } : { label: "后台" },
    ...trail,
  ];

  return (
    <>
      {mobileImmersive ? <span className="adminMobileImmersiveMarker" hidden /> : null}
      <Breadcrumbs className="adminBreadcrumbs" items={breadcrumbItems} />
      {notice ? (
        <DismissibleNotice
          message={notice}
          tone={tone}
          variant="admin"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      {children}
    </>
  );
}
