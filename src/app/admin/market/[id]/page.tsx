import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminMarketNavigation } from "@/components/AdminMarketNavigation";
import {
  AdminMarketDeliveryManager,
  AdminMarketProductForm,
  AdminMarketProductHeader,
} from "@/components/AdminMarketProductEditor";
import {
  getMarketProductById,
  listMarketAssets,
  listMarketDeliveryItems,
} from "@/lib/market";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminMarketProductPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    setup?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AdminMarketProductPage({ params, searchParams }: AdminMarketProductPageProps) {
  const id = Number((await params).id);
  const product = getMarketProductById(id);
  if (!product) notFound();
  const query = await searchParams;
  const tab = query.tab === "delivery" || query.tab === "inventory" ? "delivery" : "info";
  const setup = query.setup === "1";
  const deliveries = listMarketDeliveryItems(id);
  const assets = listMarketAssets(id);
  const suffix = setup ? "&setup=1" : "";

  return (
    <AdminFrame
      active="market"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[{ label: "集市管理", href: "/admin/market" }, { label: product.title }]}
    >
      <div className="adminWorkspace">
        <AdminMarketNavigation active="products" />
        <AdminMarketProductHeader product={product} setup={setup} tab={tab} />
        <nav className="adminProductTabs" aria-label="商品编辑">
          <Link className={tab === "info" ? "isActive" : ""} href={`/admin/market/${id}?tab=info${suffix}`}>商品信息</Link>
          <Link className={tab === "delivery" ? "isActive" : ""} href={`/admin/market/${id}?tab=delivery${suffix}`}>交付设置</Link>
        </nav>
        {setup ? (
          <ol className="adminPublishSteps adminPublishStepsInline" aria-label="上架步骤">
            <li><span>1</span>商品信息</li>
            <li className="isActive"><span>2</span>交付设置</li>
          </ol>
        ) : null}
        {tab === "info" ? <AdminMarketProductForm product={product} /> : null}
        {tab === "delivery" ? (
          <AdminMarketDeliveryManager
            productId={id}
            deliveries={deliveries}
            assets={assets}
            stock={product.stock || 0}
          />
        ) : null}
      </div>
    </AdminFrame>
  );
}
