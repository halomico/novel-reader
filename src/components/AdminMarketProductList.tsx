"use client";

import { Cookie, CupSoda, Edit3, Eye, EyeOff, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  deleteMarketProductAction,
  setMarketProductStatusAction,
} from "@/app/admin/market/actions";
import type { MarketProduct } from "@/lib/market";
import { InlineMutationNotice, useInlineMutation } from "./useInlineMutation";

type ProductFilter = "all" | "published" | "offline";

function priceLabel(product: MarketProduct): string {
  const prices = [
    product.priceCookie == null ? "" : `${product.priceCookie} 曲奇`,
    product.priceSoda == null ? "" : `${product.priceSoda} 苏打`,
  ].filter(Boolean);
  return prices.join(" / ") || "免费";
}

export function AdminMarketProductList({ products: initialProducts }: { products: MarketProduct[] }) {
  const mutation = useInlineMutation();
  const [products, setProducts] = useState(initialProducts);
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [query, setQuery] = useState("");

  const filteredProducts = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return products.filter((product) => {
      if (filter === "published" && product.status !== "published") return false;
      if (filter === "offline" && product.status === "published") return false;
      return !keyword ||
        product.title.toLocaleLowerCase("zh-CN").includes(keyword) ||
        product.slug.toLocaleLowerCase("en-US").includes(keyword);
    });
  }, [filter, products, query]);

  const publishedCount = products.filter((product) => product.status === "published").length;

  function toggleStatus(product: MarketProduct) {
    const nextStatus = product.status === "published" ? "archived" : "published";
    mutation.run(
      () => setMarketProductStatusAction(product.id, nextStatus),
      (result) => {
        if (!result.ok || !result.data) return;
        setProducts((current) => current.map((item) => (
          item.id === product.id ? { ...item, status: result.data!.status } : item
        )));
      },
    );
  }

  function removeProduct(product: MarketProduct) {
    if (!window.confirm(`删除商品“${product.title}”？已购订单与交付记录会保留。`)) return;
    mutation.run(
      () => deleteMarketProductAction(product.id),
      (result) => {
        if (result.ok) setProducts((current) => current.filter((item) => item.id !== product.id));
      },
    );
  }

  return (
    <section className="adminCommerceList">
      <div className="adminCommerceToolbar">
        <div className="adminCompactTabs" role="tablist" aria-label="商品状态">
          <button className={filter === "all" ? "isActive" : ""} type="button" onClick={() => setFilter("all")}>
            全部 <span>{products.length}</span>
          </button>
          <button className={filter === "published" ? "isActive" : ""} type="button" onClick={() => setFilter("published")}>
            已上架 <span>{publishedCount}</span>
          </button>
          <button className={filter === "offline" ? "isActive" : ""} type="button" onClick={() => setFilter("offline")}>
            已下架 <span>{products.length - publishedCount}</span>
          </button>
        </div>
        <label className="adminCommerceSearch">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索商品"
            aria-label="搜索商品"
          />
        </label>
      </div>

      <InlineMutationNotice notice={mutation.notice} />

      <div className="adminCommerceTableWrap">
        <table className="adminCommerceTable">
          <thead>
            <tr>
              <th>商品</th>
              <th>价格</th>
              <th>交付</th>
              <th>库存</th>
              <th>状态</th>
              <th><span className="srOnly">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length ? filteredProducts.map((product) => (
              <tr key={product.id}>
                <td>
                  <Link className="adminCommerceProductName" href={`/admin/market/${product.id}`}>
                    <strong>{product.title}</strong>
                    <small>/{product.slug}</small>
                  </Link>
                </td>
                <td>
                  <span className="adminCommercePrice">
                    {product.priceSoda != null && product.priceCookie == null
                      ? <CupSoda size={14} aria-hidden="true" />
                      : <Cookie size={14} aria-hidden="true" />}
                    {priceLabel(product)}
                  </span>
                </td>
                <td>{product.deliveryCount} 项</td>
                <td>{product.stock == null ? "不限" : product.stock}</td>
                <td>
                  <span className={product.status === "published" ? "adminStatusBadge isLive" : "adminStatusBadge"}>
                    {product.status === "published" ? "已上架" : "已下架"}
                  </span>
                </td>
                <td>
                  <div className="adminCommerceRowActions">
                    <Link className="adminTableIconButton" href={`/admin/market/${product.id}`} title="编辑" aria-label={`编辑 ${product.title}`}>
                      <Edit3 size={15} aria-hidden="true" />
                    </Link>
                    <button
                      className="adminTableIconButton"
                      type="button"
                      disabled={mutation.pending}
                      onClick={() => toggleStatus(product)}
                      title={product.status === "published" ? "下架" : "上架"}
                      aria-label={`${product.status === "published" ? "下架" : "上架"} ${product.title}`}
                    >
                      {product.status === "published"
                        ? <EyeOff size={15} aria-hidden="true" />
                        : <Eye size={15} aria-hidden="true" />}
                    </button>
                    <button
                      className="adminTableIconButton isDanger"
                      type="button"
                      disabled={mutation.pending}
                      onClick={() => removeProduct(product)}
                      title="删除"
                      aria-label={`删除 ${product.title}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="adminCommerceEmpty">没有符合条件的商品</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
