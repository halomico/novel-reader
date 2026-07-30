import { Bell, Flag, Mail, Plus } from "lucide-react";
import Link from "next/link";

type AdminStationSection = "inbox" | "reports" | "announcements";

const ITEMS: Array<{
  key: AdminStationSection;
  href: string;
  label: string;
  icon: typeof Mail;
}> = [
  { key: "inbox", href: "/admin/station", label: "留言", icon: Mail },
  { key: "reports", href: "/admin/station/reports", label: "举报", icon: Flag },
  { key: "announcements", href: "/admin/station/announcements", label: "公告", icon: Bell },
];

export function AdminStationNavigation({
  active,
  showCreate = false,
}: {
  active: AdminStationSection;
  showCreate?: boolean;
}) {
  return (
    <div className="adminWorkspaceBar">
      <nav className="adminWorkspaceNav" aria-label="站务管理">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link className={active === item.key ? "isActive" : ""} href={item.href} key={item.key}>
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      {showCreate ? (
        <Link className="adminPrimaryLink" href="/admin/station/announcements/new">
          <Plus size={15} aria-hidden="true" />
          发布公告
        </Link>
      ) : null}
    </div>
  );
}
