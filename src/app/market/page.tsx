import { ArrowLeftRight, Cookie, CupSoda, ReceiptText, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/components/LocalizedLink";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { MarketWalletTools } from "@/components/MarketWalletTools";
import { UserWorkspace } from "@/components/UserWorkspace";
import { WorkspacePage, WorkspacePageHeader, WorkspacePrimaryTabs } from "@/components/WorkspacePageChrome";
import { CurrencyBalance } from "@/components/CurrencyBalance";
import {
  getCookieToSodaRate,
  getNoticeDisplaySeconds,
  isBidirectionalCurrencyExchangeEnabled,
  isMarketEnabled,
} from "@/lib/config";
import {
  listMarketProducts,
  listUserMarketOrders,
  marketProductCoverUrl,
} from "@/lib/market";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { getRequestLocale } from "@/lib/locale-server";
import { uiText } from "@/lib/locale";
import { formatCompactUpdateDate, parseAppDateTime } from "@/lib/date-time";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "集市", robots: { index: false, follow: false } };

type MarketPageProps = {
  searchParams: Promise<{ view?: string; notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function MarketPage({ searchParams }: MarketPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Fmarket");
  if (!isMarketEnabled() || !hasUserPermission(user, "market_access")) notFound();
  const params = await searchParams;
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const view = params.view === "products" || params.view === "orders" ? params.view : "exchange";
  const products = view === "products" ? listMarketProducts() : [];
  const orders = view === "orders" ? listUserMarketOrders(user.id, 100) : [];
  const cookieToSodaRate = getCookieToSodaRate();
  const bidirectionalExchangeEnabled = isBidirectionalCurrencyExchangeEnabled();

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
      <WorkspacePage className="marketOverview">
        <WorkspacePageHeader
          className="marketPageHeader"
          icon={ShoppingBag}
          title="集市"
          trailing={<div className="currencyBalanceGroup marketBalances" aria-label="账户余额">
            <CurrencyBalance currency="cookie" label={tr("曲奇")} amount={user.cookieBalance} />
            <CurrencyBalance currency="soda" label={tr("苏打")} amount={user.sodaBalance} />
          </div>}
        />
        <WorkspacePrimaryTabs
          className="marketTabs"
          label={tr("集市")}
          items={[
            { href: "/market", label: tr("兑换"), icon: ArrowLeftRight, active: view === "exchange" },
            { href: "/market?view=products", label: tr("商品"), icon: ShoppingBag, active: view === "products" },
            { href: "/market?view=orders", label: tr("订单"), icon: ReceiptText, active: view === "orders" },
          ]}
        />

        {view === "exchange" ? (
          <MarketWalletTools
            cookieBalance={user.cookieBalance}
            sodaBalance={user.sodaBalance}
            cookieToSodaRate={cookieToSodaRate}
            bidirectionalExchangeEnabled={bidirectionalExchangeEnabled}
          />
        ) : null}

        {view === "products" ? (
          <section className="marketProductsSection" aria-label={tr("商品")}>
            <div className="marketProductGrid">
              {products.map((product) => {
                const locked = user.trustLevel < product.minLevel;
                const coverUrl = marketProductCoverUrl(product);
                return (
                  <Link className="marketProductCard" href={`/market/${product.slug}`} key={product.id}>
                    <span className="marketProductVisual">
                      {coverUrl ? (
                        <Image src={coverUrl} alt="" width={192} height={108} unoptimized />
                      ) : <ShoppingBag size={30} strokeWidth={1.6} aria-hidden="true" />}
                    </span>
                    <span className="marketProductCopy"><strong>{product.title}</strong></span>
                    <span className="marketProductMeta">
                      <span className="marketProductPrices">
                        {product.priceCookie != null ? <b aria-label={`${product.priceCookie} 曲奇`} title={`${product.priceCookie} 曲奇`}><Cookie size={14} aria-hidden="true" />{product.priceCookie}</b> : null}
                        {product.priceSoda != null ? <b aria-label={`${product.priceSoda} 苏打`} title={`${product.priceSoda} 苏打`}><CupSoda size={14} aria-hidden="true" />{product.priceSoda}</b> : null}
                      </span>
                      <span className="marketProductAvailability">
                        <small className={product.stock === 0 ? "marketProductStock isEmpty" : "marketProductStock"}>
                          {product.stock == null ? "库存充足" : product.stock > 0 ? `库存 ${product.stock}` : "暂时缺货"}
                        </small>
                        {locked ? <small className="marketProductLevel">Lv.{product.minLevel}</small> : null}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
            {!products.length ? <p className="marketEmpty">暂时没有上架商品。</p> : null}
          </section>
        ) : null}

        {view === "orders" ? (
          <section className="marketRecentOrders marketOrdersSection" aria-label={tr("订单")}>
            <header><ReceiptText size={18} aria-hidden="true" /><h2>{tr("订单")}</h2></header>
            {orders.length ? (
              <div>
                {orders.map((order) => (
                  <Link href={`/market/orders/${order.orderNo}`} key={order.id}>
                    <span><strong>{order.productTitle}</strong><small>{order.orderNo} · {order.amount} {order.currency === "soda" ? "苏打" : "曲奇"}</small></span>
                    <time dateTime={order.createdAt}>{formatCompactUpdateDate(parseAppDateTime(order.createdAt)?.getTime() || Date.now())}</time>
                  </Link>
                ))}
              </div>
            ) : <p className="marketEmpty">暂无订单。</p>}
          </section>
        ) : null}
      </WorkspacePage>
    </UserWorkspace>
  );
}
