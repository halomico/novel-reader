"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { removeAdminMarketOrderAction } from "@/app/admin/market/actions";
import type { MarketOrder } from "@/lib/market";
import { LocalDateTime } from "./LocalDateTime";
import { InlineMutationNotice, useInlineMutation } from "./useInlineMutation";

export function AdminMarketOrderList({ orders: initialOrders }: { orders: MarketOrder[] }) {
  const mutation = useInlineMutation();
  const [orders, setOrders] = useState(initialOrders);

  function remove(order: MarketOrder) {
    if (!window.confirm("从后台订单列表移除这条记录？用户已购内容与账本会继续保留。")) return;
    mutation.run(
      () => removeAdminMarketOrderAction(order.id),
      (result) => {
        if (result.ok) setOrders((current) => current.filter((item) => item.id !== order.id));
      },
    );
  }

  return (
    <>
      <InlineMutationNotice notice={mutation.notice} />
      <div className="adminCommerceTableWrap">
        <table className="adminCommerceTable">
          <thead><tr><th>订单</th><th>商品</th><th>用户</th><th>实付</th><th>状态</th><th>时间</th><th><span className="srOnly">操作</span></th></tr></thead>
          <tbody>
            {orders.length ? orders.map((order) => (
              <tr key={order.id}>
                <td><code>{order.orderNo}</code></td>
                <td>{order.productTitle}</td>
                <td><Link href={`/admin/users/${order.userId}`}>#{order.userId}</Link></td>
                <td>{order.amount} {order.currency === "cookie" ? "曲奇" : "苏打"}</td>
                <td><span className="adminStatusBadge isLive">已交付</span></td>
                <td><LocalDateTime value={order.createdAt} /></td>
                <td>
                  <button
                    className="adminTableIconButton isDanger"
                    type="button"
                    onClick={() => remove(order)}
                    disabled={mutation.pending}
                    title="删除"
                    aria-label={`删除订单 ${order.orderNo}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            )) : <tr><td colSpan={7} className="adminCommerceEmpty">暂无订单</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
