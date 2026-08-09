import { Package, Plus, ReceiptText, TicketCheck } from "lucide-react";
import Link from "next/link";

type AdminMarketSection = "products" | "orders" | "codes";

const ITEMS: Array<{
  key: AdminMarketSection;
  href: string;
  label: string;
  icon: typeof Package;
}> = [
  { key: "products", href: "/admin/market", label: "商品", icon: Package },
  { key: "orders", href: "/admin/market/orders", label: "订单", icon: ReceiptText },
  { key: "codes", href: "/admin/market/codes", label: "兑换码", icon: TicketCheck },
];

export function AdminMarketNavigation({
  active,
  showCreate = false,
}: {
  active: AdminMarketSection;
  showCreate?: boolean;
}) {
  return (
    <div className="adminWorkspaceBar">
      <nav className="adminWorkspaceNav" aria-label="集市管理">
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
        <Link className="adminPrimaryLink" href="/admin/market/new">
          <Plus size={15} aria-hidden="true" />
          上架商品
        </Link>
      ) : null}
    </div>
  );
}
