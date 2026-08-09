import { Download, KeyRound, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CopyTextButton } from "@/components/CopyTextButton";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, isMarketEnabled } from "@/lib/config";
import {
  getUserMarketOrder,
  listMarketOrderDeliveries,
  revealOrderDeliveryContent,
} from "@/lib/market";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "订单交付", robots: { index: false, follow: false } };

type MarketOrderPageProps = {
  params: Promise<{ orderNo: string }>;
  searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function MarketOrderPage({ params, searchParams }: MarketOrderPageProps) {
  const user = await getCurrentUser();
  const { orderNo } = await params;
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/market/orders/${orderNo}`)}`);
  if (!isMarketEnabled() || !hasUserPermission(user, "market_access")) notFound();
  const order = getUserMarketOrder(user.id, orderNo);
  if (!order || order.status !== "fulfilled") notFound();
  const deliveries = listMarketOrderDeliveries(order.id);
  const query = await searchParams;

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[
        { label: "首页", href: "/" },
        { label: "集市", href: "/market" },
        { label: order.productTitle },
      ]} />
      {query.notice ? (
        <DismissibleNotice
          message={query.notice}
          tone={query.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      <article className="marketOrderPage">
        <header>
          <div>
            <h1>{order.productTitle}</h1>
            <p>{order.orderNo}</p>
          </div>
          <time>{new Date(order.createdAt).toLocaleString("zh-CN")}</time>
        </header>
        <div className="marketOrderDeliveries">
          {deliveries.map((delivery) => {
            if (delivery.kind === "secret") {
              const content = revealOrderDeliveryContent(delivery);
              return (
                <section className="marketOrderSecret" key={delivery.id}>
                  <header><KeyRound size={17} aria-hidden="true" /><h2>{delivery.title || "卡密"}</h2></header>
                  <code>{content}</code>
                  <CopyTextButton value={content} />
                </section>
              );
            }
            if (delivery.kind === "file" && delivery.asset) {
              return (
                <section className="marketOrderFile" key={delivery.id}>
                  <span><Download size={18} aria-hidden="true" /><strong>{delivery.title || delivery.asset.fileName}</strong></span>
                  <a href={`/market/orders/${encodeURIComponent(order.orderNo)}/download/${delivery.asset.id}`}>下载</a>
                </section>
              );
            }
            if (delivery.kind === "entitlement") {
              return (
                <section className="marketOrderEntitlement" key={delivery.id}>
                  <LockKeyhole size={18} aria-hidden="true" />
                  <strong>{delivery.title || "权益已开通"}</strong>
                </section>
              );
            }
            return (
              <section className="marketMarkdown" key={delivery.id}>
                {delivery.title ? <h2>{delivery.title}</h2> : null}
                <ReactMarkdown>{delivery.content}</ReactMarkdown>
              </section>
            );
          })}
        </div>
      </article>
    </main>
  );
}
