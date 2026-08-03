import { Cookie, CupSoda, PackageOpen, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/components/LocalizedLink";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { MarketWalletTools } from "@/components/MarketWalletTools";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getCookieToSodaRate, getNoticeDisplaySeconds, isMarketEnabled } from "@/lib/config";
import {
  listMarketProducts,
  listUserMarketOrders,
  marketProductCoverUrl,
} from "@/lib/market";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "集市", robots: { index: false, follow: false } };

type MarketPageProps = {
  searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function MarketPage({ searchParams }: MarketPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Fmarket");
  if (!isMarketEnabled() || !hasUserPermission(user, "market_access")) notFound();
  const params = await searchParams;
  const products = listMarketProducts();
  const orders = listUserMarketOrders(user.id, 8);
  const cookieToSodaRate = getCookieToSodaRate();

  return (
    <UserWorkspace user={user} active="market" breadcrumb="集市">
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      <section className="marketOverview">
        <header className="marketPageHeader">
          <div>
            <h1>集市</h1>
            <p>兑换后立即交付，订单内容只对当前账号可见。</p>
          </div>
          <div className="marketBalances" aria-label="账户余额">
            <span><Cookie size={16} aria-hidden="true" /><strong>{user.cookieBalance}</strong> 曲奇</span>
            <span><CupSoda size={16} aria-hidden="true" /><strong>{user.sodaBalance}</strong> 苏打</span>
          </div>
        </header>

        <MarketWalletTools
          cookieBalance={user.cookieBalance}
          cookieToSodaRate={cookieToSodaRate}
        />

        <div className="marketProductGrid">
          {products.map((product) => {
            const locked = user.trustLevel < product.minLevel;
            const coverUrl = marketProductCoverUrl(product);
            return (
              <Link className="marketProductCard" href={`/market/${product.slug}`} key={product.id}>
                <span className="marketProductVisual">
                  {coverUrl ? (
                    <Image src={coverUrl} alt="" width={192} height={108} unoptimized />
                  ) : <PackageOpen size={21} aria-hidden="true" />}
                </span>
                <span className="marketProductCopy">
                  <strong>{product.title}</strong>
                  {product.description ? (
                    <small>{product.description.replace(/[#*_`>\[\]()~-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}</small>
                  ) : null}
                </span>
                <span className="marketProductMeta">
                  <small className={product.stock === 0 ? "isEmpty" : ""}>
                    {product.stock == null ? "库存充足" : product.stock > 0 ? `库存 ${product.stock}` : "暂时缺货"}
                  </small>
                  {locked ? <small>Lv.{product.minLevel}</small> : null}
                  {product.priceCookie != null ? <b><Cookie size={14} aria-hidden="true" />{product.priceCookie}</b> : null}
                  {product.priceSoda != null ? <b><CupSoda size={14} aria-hidden="true" />{product.priceSoda}</b> : null}
                </span>
              </Link>
            );
          })}
        </div>
        {!products.length ? <p className="marketEmpty">暂时没有上架商品。</p> : null}

        {orders.length ? (
          <section className="marketRecentOrders">
            <header><ReceiptText size={18} aria-hidden="true" /><h2>最近订单</h2></header>
            <div>
              {orders.map((order) => (
                <Link href={`/market/orders/${order.orderNo}`} key={order.id}>
                  <span><strong>{order.productTitle}</strong><small>{order.orderNo}</small></span>
                  <time>{new Date(order.createdAt).toLocaleString("zh-CN")}</time>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </UserWorkspace>
  );
}
