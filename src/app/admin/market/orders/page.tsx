import type { Metadata } from "next";
import { AdminMarketNavigation } from "@/components/AdminMarketNavigation";
import { AdminMarketOrderList } from "@/components/AdminMarketOrderList";
import { listAdminMarketOrders } from "@/lib/market";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminMarketOrdersPage() {
  const orders = listAdminMarketOrders(200);
  return (
    <AdminFrame active="market" breadcrumbs={[{ label: "集市管理", href: "/admin/market" }, { label: "订单" }]}>
      <div className="adminWorkspace">
        <AdminMarketNavigation active="orders" />
        <header className="adminWorkspaceHeader"><div><h1>订单</h1><p>查看最近完成的商品交付。</p></div></header>
        <AdminMarketOrderList orders={orders} />
      </div>
    </AdminFrame>
  );
}
