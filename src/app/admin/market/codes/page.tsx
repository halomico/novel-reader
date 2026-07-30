import type { Metadata } from "next";
import { AdminMarketNavigation } from "@/components/AdminMarketNavigation";
import { AdminRedemptionCodeGenerator } from "@/components/AdminMarketTools";
import { LocalDateTime } from "@/components/LocalDateTime";
import { listMarketProducts, listRedemptionCodeBatches } from "@/lib/market";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminMarketCodesPage() {
  const products = listMarketProducts({ includeUnpublished: true });
  const batches = listRedemptionCodeBatches(100);
  return (
    <AdminFrame active="market" breadcrumbs={[{ label: "集市管理", href: "/admin/market" }, { label: "兑换码" }]}>
      <div className="adminWorkspace">
        <AdminMarketNavigation active="codes" />
        <header className="adminWorkspaceHeader"><div><h1>兑换码</h1><p>生成后仅显示一次，可交由独立支付站分发。</p></div></header>
        <section className="adminCodeWorkspace">
          <div className="adminCommerceFormSection">
            <header><h2>生成兑换码</h2></header>
            <AdminRedemptionCodeGenerator products={products.map(({ id, title }) => ({ id, title }))} />
          </div>
          <div className="adminCommerceTableWrap">
            <table className="adminCommerceTable">
              <thead><tr><th>批次</th><th>内容</th><th>核销</th><th>状态</th><th>创建时间</th></tr></thead>
              <tbody>
                {batches.length ? batches.map((batch) => (
                  <tr key={batch.id}>
                    <td><strong>{batch.name}</strong></td>
                    <td>{batch.rewardType === "product" ? "商品" : batch.rewardType === "cookie" ? `${batch.rewardAmount} 曲奇` : `${batch.rewardAmount} 苏打`}</td>
                    <td>{batch.redeemedCodes} / {batch.totalCodes}</td>
                    <td><span className={batch.status === "active" ? "adminStatusBadge isLive" : "adminStatusBadge"}>{batch.status === "active" ? "可用" : "停用"}</span></td>
                    <td><LocalDateTime value={batch.createdAt} /></td>
                  </tr>
                )) : <tr><td colSpan={5} className="adminCommerceEmpty">暂无兑换码批次</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminFrame>
  );
}
