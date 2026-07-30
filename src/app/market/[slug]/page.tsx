import { Cookie, CupSoda, Download, KeyRound, LockKeyhole, PackageCheck, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, isMarketEnabled } from "@/lib/config";
import {
  getMarketProductBySlug,
  listMarketDeliveryItems,
  marketProductCoverUrl,
} from "@/lib/market";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { purchaseMarketProductAction } from "../actions";

export const dynamic = "force-dynamic";

type MarketProductPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }>;
};

export async function generateMetadata({ params }: MarketProductPageProps): Promise<Metadata> {
  const product = getMarketProductBySlug((await params).slug);
  return { title: product?.title || "商品", robots: { index: false, follow: false } };
}

const DELIVERY_META = {
  text: { label: "说明", icon: ScrollText },
  secret: { label: "卡密", icon: KeyRound },
  file: { label: "文件", icon: Download },
  entitlement: { label: "权益", icon: LockKeyhole },
} as const;

export default async function MarketProductPage({ params, searchParams }: MarketProductPageProps) {
  const user = await getCurrentUser();
  const { slug } = await params;
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/market/${slug}`)}`);
  if (!isMarketEnabled() || !hasUserPermission(user, "market_access")) notFound();
  const product = getMarketProductBySlug(slug);
  if (!product || product.status !== "published") notFound();
  const query = await searchParams;
  const deliveries = listMarketDeliveryItems(product.id);
  const locked = user.trustLevel < product.minLevel;
  const canPurchase = !locked && hasUserPermission(user, "market_purchase") && deliveries.length > 0;
  const coverUrl = marketProductCoverUrl(product);

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[
        { label: "首页", href: "/" },
        { label: "集市", href: "/market" },
        { label: product.title },
      ]} />
      {query.notice ? (
        <DismissibleNotice
          message={query.notice}
          tone={query.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      <article className="marketProductPage">
        <header className={coverUrl ? "hasCover" : ""}>
          {coverUrl ? (
            <Image className="marketProductHeroCover" src={coverUrl} alt="" width={320} height={180} unoptimized />
          ) : null}
          <div>
            <h1>{product.title}</h1>
            {product.summary ? <p>{product.summary}</p> : null}
          </div>
          <div className="marketProductPrice">
            {product.priceCookie != null ? <span><Cookie size={17} aria-hidden="true" />{product.priceCookie} 曲奇</span> : null}
            {product.priceSoda != null ? <span><CupSoda size={17} aria-hidden="true" />{product.priceSoda} 苏打</span> : null}
          </div>
        </header>

        <p className={product.stock === 0 ? "marketStockLine isEmpty" : "marketStockLine"}>
          <PackageCheck size={16} aria-hidden="true" />
          {product.stock == null ? "库存充足" : product.stock > 0 ? `库存 ${product.stock}` : "暂时缺货"}
        </p>

        {product.description ? (
          <div className="marketMarkdown"><ReactMarkdown>{product.description}</ReactMarkdown></div>
        ) : null}

        <section className="marketDeliveryPreview">
          {deliveries.map((delivery) => {
            const meta = DELIVERY_META[delivery.kind];
            const Icon = meta.icon;
            return (
              <span key={delivery.id}>
                <Icon size={16} aria-hidden="true" />
                {delivery.title || meta.label}
              </span>
            );
          })}
        </section>

        {locked ? <p className="marketStatusText">达到 Lv.{product.minLevel} 后可购买</p> : null}
        <div className="marketPurchaseActions">
          {product.priceCookie != null ? (
            <form action={purchaseMarketProductAction}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="slug" value={product.slug} />
              <input type="hidden" name="currency" value="cookie" />
              <button type="submit" disabled={!canPurchase || product.stock === 0}>
                <Cookie size={16} aria-hidden="true" />用曲奇购买
              </button>
            </form>
          ) : null}
          {product.priceSoda != null ? (
            <form action={purchaseMarketProductAction}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="slug" value={product.slug} />
              <input type="hidden" name="currency" value="soda" />
              <button type="submit" disabled={!canPurchase || product.stock === 0}>
                <CupSoda size={16} aria-hidden="true" />用苏打购买
              </button>
            </form>
          ) : null}
        </div>
      </article>
    </main>
  );
}
