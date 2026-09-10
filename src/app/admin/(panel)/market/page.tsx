import type { Metadata } from "next";
import { AdminMarketNavigation } from "@/components/AdminMarketNavigation";
import { AdminMarketProductList } from "@/components/AdminMarketProductList";
import { database } from "@/core/db/postgres";
import { listPostgresMarketProducts } from "@/domains/market/postgres-market";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminMarketPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AdminMarketPage({ searchParams }: AdminMarketPageProps) {
  const query = await searchParams;
  const products = await listPostgresMarketProducts(database(), { includeUnpublished: true });

  return (
    <AdminFrame active="market" notice={query.notice} tone={query.tone}>
      <div className="adminWorkspace">
        <AdminMarketNavigation active="products" showCreate />
        <header className="adminWorkspaceHeader">
          <div><h1>商品管理</h1><p>管理上架状态、价格和交付内容。</p></div>
        </header>
        <AdminMarketProductList products={products} />
      </div>
    </AdminFrame>
  );
}
