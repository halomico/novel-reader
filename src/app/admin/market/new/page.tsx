import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { AdminMarketNavigation } from "@/components/AdminMarketNavigation";
import { AdminMarketPriceSelector } from "@/components/AdminMarketPriceSelector";
import { AdminFrame } from "../../AdminFrame";
import { createMarketProductAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminMarketNewPageProps = {
  searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function AdminMarketNewPage({ searchParams }: AdminMarketNewPageProps) {
  const query = await searchParams;
  return (
    <AdminFrame
      active="market"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[{ label: "集市管理", href: "/admin/market" }, { label: "上架商品" }]}
    >
      <div className="adminWorkspace">
        <AdminMarketNavigation active="products" />
        <header className="adminWorkspaceHeader">
          <div><h1>上架商品</h1><p>先填写商品信息，再配置购买后的交付内容。</p></div>
          <ol className="adminPublishSteps" aria-label="上架步骤">
            <li className="isActive"><span>1</span>商品信息</li>
            <li><span>2</span>交付设置</li>
          </ol>
        </header>
        <form className="adminCommerceForm adminCommerceCreateForm" action={createMarketProductAction}>
          <section className="adminCommerceFormSection">
            <header><h2>基本信息</h2><p>只有名称是必填项。</p></header>
            <div className="adminCommerceFieldGrid">
              <label className="isWide"><span>商品名称</span><input name="title" maxLength={120} required autoFocus /></label>
              <label><span>链接标识</span><input name="slug" pattern="[a-z0-9][a-z0-9-]{1,78}[a-z0-9]" placeholder="留空自动生成" /></label>
              <label className="isFull"><span>商品简述（可选）</span><input name="summary" maxLength={240} /></label>
              <label className="isFull"><span>商品介绍（可选）</span><textarea name="description" rows={8} maxLength={20000} /><small>支持 Markdown</small></label>
            </div>
          </section>
          <section className="adminCommerceFormSection">
            <header><h2>销售设置</h2><p>选择一种支付方式；价格为 0 时可免费领取。</p></header>
            <div className="adminCommerceFieldGrid">
              <label><span>开放等级</span><input name="minLevel" type="number" min="1" max="6" defaultValue="1" /></label>
              <label><span>每人限购</span><input name="purchaseLimitPerUser" type="number" min="0" max="10000" defaultValue="1" /></label>
              <div className="adminMarketPriceRow"><AdminMarketPriceSelector /></div>
            </div>
          </section>
          <footer className="adminCommerceStickyActions">
            <button type="submit">继续配置交付<ArrowRight size={15} aria-hidden="true" /></button>
          </footer>
        </form>
      </div>
    </AdminFrame>
  );
}
