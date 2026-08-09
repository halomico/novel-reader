"use client";

import {
  ArrowRight,
  Check,
  Download,
  EyeOff,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Plus,
  Save,
  ScrollText,
  Send,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  deleteMarketProductAction,
  deleteMarketDeliveryItemInlineAction,
  importMarketSecretsInlineAction,
  saveMarketDeliveryItemInlineAction,
  setMarketProductStatusAction,
  updateMarketProductInlineAction,
} from "@/app/admin/market/actions";
import type { MarketAsset, MarketDeliveryItem, MarketDeliveryKind, MarketProduct } from "@/lib/market";
import { decodeEntitlementDefinition } from "@/lib/entitlement-protocol";
import { AdminEntitlementPicker } from "./AdminEntitlementPicker";
import { AdminMarketCoverUploader, AdminMarketFilePicker } from "./AdminMarketTools";
import { AdminMarketPriceSelector } from "./AdminMarketPriceSelector";
import { InlineMutationNotice, mutationNoticePath, useInlineMutation } from "./useInlineMutation";

const DELIVERY_LABELS: Record<MarketDeliveryKind, string> = {
  text: "说明",
  secret: "卡密",
  file: "文件",
  entitlement: "权益",
};

const DELIVERY_ICONS = {
  text: ScrollText,
  secret: KeyRound,
  file: Download,
  entitlement: LockKeyhole,
} satisfies Record<MarketDeliveryKind, typeof ScrollText>;

const DELIVERY_OPTIONS: Array<{
  kind: MarketDeliveryKind;
  label: string;
  description: string;
}> = [
  { kind: "file", label: "文件", description: "上传并交付下载文件" },
  { kind: "secret", label: "卡密", description: "每笔订单发放一条" },
  { kind: "text", label: "说明", description: "购买后展示文字内容" },
  { kind: "entitlement", label: "权限", description: "解锁站内资源" },
];

function dispatchProduct(product: MarketProduct) {
  window.dispatchEvent(new CustomEvent("admin-market-product-updated", { detail: product }));
}

export function AdminMarketProductHeader({
  product: initialProduct,
  setup = false,
  tab,
}: {
  product: MarketProduct;
  setup?: boolean;
  tab: "info" | "delivery";
}) {
  const router = useRouter();
  const mutation = useInlineMutation();
  const [product, setProduct] = useState(initialProduct);

  useEffect(() => {
    const update = (event: Event) => setProduct((event as CustomEvent<MarketProduct>).detail);
    window.addEventListener("admin-market-product-updated", update);
    return () => window.removeEventListener("admin-market-product-updated", update);
  }, []);

  function toggleStatus() {
    const status = product.status === "published" ? "archived" : "published";
    mutation.run(
      () => setMarketProductStatusAction(product.id, status),
      (result) => {
        if (!result.ok || !result.data) return;
        const next = { ...product, status: result.data.status };
        setProduct(next);
        dispatchProduct(next);
        if (result.data.status === "published") {
          router.push(mutationNoticePath("/admin/market", result));
        }
      },
    );
  }

  function removeProduct() {
    if (!window.confirm(`删除商品“${product.title}”？已购订单与交付记录会保留。`)) return;
    mutation.run(
      () => deleteMarketProductAction(product.id),
      (result) => {
        if (result.ok) router.push("/admin/market");
      },
    );
  }

  return (
    <header className="adminCommerceProductHeader">
      <div>
        <span className={product.status === "published" ? "adminStatusBadge isLive" : "adminStatusBadge"}>
          {product.status === "published" ? "已上架" : "已下架"}
        </span>
        <h1>{product.title}</h1>
        <small>/{product.slug}</small>
      </div>
      <div className="adminCommerceHeaderActions">
        {product.status === "published" ? (
          <Link href={`/market/${product.slug}`} target="_blank">
            <ExternalLink size={15} aria-hidden="true" />
            预览
          </Link>
        ) : null}
        {product.status === "published" || tab === "delivery" ? (
          <button
            className={product.status === "published" ? "adminSecondaryButton" : ""}
            type="button"
            disabled={mutation.pending}
            onClick={toggleStatus}
          >
            {product.status === "published"
              ? <EyeOff size={15} aria-hidden="true" />
              : <Send size={15} aria-hidden="true" />}
            {product.status === "published" ? "下架" : setup ? "发布" : "上架"}
          </button>
        ) : null}
        <button
          className="adminDangerIconButton"
          type="button"
          disabled={mutation.pending}
          onClick={removeProduct}
          title="删除商品"
          aria-label={`删除 ${product.title}`}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
      <InlineMutationNotice notice={mutation.notice} />
    </header>
  );
}

export function AdminMarketProductForm({ product: initialProduct }: { product: MarketProduct }) {
  const router = useRouter();
  const mutation = useInlineMutation();
  const [product, setProduct] = useState(initialProduct);
  const shouldPublish = product.status !== "published" && product.deliveryCount > 0;
  const needsDelivery = product.status !== "published" && product.deliveryCount === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => updateMarketProductInlineAction(formData),
      (result) => {
        if (!result.ok || !result.data) return;
        setProduct(result.data.product);
        dispatchProduct(result.data.product);
        router.push(mutationNoticePath(
          needsDelivery
            ? `/admin/market/${product.id}?tab=delivery&setup=1`
            : "/admin/market",
          result,
        ));
      },
    );
  }

  return (
    <div className="adminProductInfoWorkspace">
      <section className="adminCommerceFormSection">
        <header><h2>商品封面</h2><p>列表与详情页共用，上传后自动压缩。</p></header>
        <AdminMarketCoverUploader productId={product.id} initialCoverKey={product.coverKey} />
      </section>
      <form className="adminCommerceForm" onSubmit={submit} key={product.id}>
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="intent" value={shouldPublish ? "publish" : "save"} />
        <section className="adminCommerceFormSection">
          <header><h2>基本信息</h2><p>只有名称是必填项。</p></header>
          <div className="adminCommerceFieldGrid">
            <label className="isWide"><span>商品名称</span><input name="title" defaultValue={product.title} maxLength={120} required /></label>
            <label><span>链接标识</span><input name="slug" defaultValue={product.slug} pattern="[a-z0-9][a-z0-9-]{1,78}[a-z0-9]" placeholder="留空自动生成" /></label>
            <label><span>排序</span><input name="sortOrder" type="number" defaultValue={product.sortOrder} /></label>
            <label className="isFull">
              <span>商品描述（可选）</span>
              <textarea name="description" defaultValue={product.description} rows={10} maxLength={20000} />
              <small>支持 Markdown</small>
            </label>
          </div>
        </section>
        <section className="adminCommerceFormSection">
          <header><h2>销售设置</h2><p>选择一种支付方式；价格为 0 时可免费领取。</p></header>
          <div className="adminCommerceFieldGrid">
            <label><span>开放等级</span><input name="minLevel" type="number" min="1" max="6" defaultValue={product.minLevel} /></label>
            <label><span>每人限购</span><input name="purchaseLimitPerUser" type="number" min="0" max="10000" defaultValue={product.purchaseLimitPerUser} /></label>
            <div className="adminMarketPriceRow">
              <AdminMarketPriceSelector
                priceCookie={product.priceCookie}
                priceSoda={product.priceSoda}
              />
            </div>
          </div>
        </section>
        <footer className="adminCommerceStickyActions">
          <InlineMutationNotice notice={mutation.notice} />
          <button type="submit" disabled={mutation.pending}>
            {mutation.pending ? <span className="buttonSpinner" /> : shouldPublish
              ? <Send size={15} aria-hidden="true" />
              : needsDelivery
                ? <ArrowRight size={15} aria-hidden="true" />
                : <Save size={15} aria-hidden="true" />}
            {shouldPublish ? "发布" : needsDelivery ? "继续配置交付" : "保存并返回"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function SecretStockEditor({
  productId,
  stock,
  onStockChange,
}: {
  productId: number;
  stock: number;
  onStockChange: (stock: number) => void;
}) {
  const mutation = useInlineMutation();
  const [secrets, setSecrets] = useState("");

  function importSecrets() {
    mutation.run(
      () => importMarketSecretsInlineAction(productId, secrets),
      (result) => {
        if (!result.ok || !result.data) return;
        setSecrets("");
        onStockChange(stock + result.data.imported);
      },
    );
  }

  return (
    <section className="adminSecretStockEditor">
      <header>
        <span><strong>卡密库存</strong><small>{stock} 条可用</small></span>
      </header>
      <InlineMutationNotice notice={mutation.notice} />
      <textarea
        value={secrets}
        onChange={(event) => setSecrets(event.target.value)}
        rows={6}
        placeholder="每行一条卡密"
      />
      <footer>
        <small>导入后加密保存，一笔订单发放一条。</small>
        <button type="button" onClick={importSecrets} disabled={mutation.pending || !secrets.trim()}>
          <Check size={15} aria-hidden="true" />
          导入
        </button>
      </footer>
    </section>
  );
}

function DeliveryEditor({
  productId,
  delivery,
  assets,
  stock,
  defaultSortOrder,
  hasSecretDelivery,
  onSaved,
  onDeleted,
  onStockChange,
  onAssetUploaded,
}: {
  productId: number;
  delivery: MarketDeliveryItem | null;
  assets: MarketAsset[];
  stock: number;
  defaultSortOrder: number;
  hasSecretDelivery: boolean;
  onSaved: (deliveries: MarketDeliveryItem[]) => void;
  onDeleted: (deliveries: MarketDeliveryItem[]) => void;
  onStockChange: (stock: number) => void;
  onAssetUploaded: (asset: MarketAsset) => void;
}) {
  const router = useRouter();
  const mutation = useInlineMutation();
  const [kind, setKind] = useState<MarketDeliveryKind | null>(delivery?.kind || null);
  const [title, setTitle] = useState(
    delivery?.title && delivery.title !== DELIVERY_LABELS[delivery.kind]
      ? delivery.title
      : "",
  );
  const entitlement = useMemo(
    () => decodeEntitlementDefinition(delivery?.kind === "entitlement" ? delivery.content : ""),
    [delivery],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind) return;
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => saveMarketDeliveryItemInlineAction(formData),
      (result) => {
        if (!result.ok || !result.data) return;
        onSaved(result.data.deliveries);
        router.push(mutationNoticePath("/admin/market", result));
      },
    );
  }

  function remove() {
    if (!delivery || !window.confirm(`删除“${delivery.title || DELIVERY_LABELS[delivery.kind]}”？`)) return;
    mutation.run(
      () => deleteMarketDeliveryItemInlineAction(productId, delivery.id),
      (result) => {
        if (result.ok && result.data) onDeleted(result.data.deliveries);
      },
    );
  }

  const CurrentIcon = kind ? DELIVERY_ICONS[kind] : null;

  return (
    <form className="adminDeliveryEditor" onSubmit={submit}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="kind" value={kind || ""} />
      <input type="hidden" name="sortOrder" value={delivery?.sortOrder ?? defaultSortOrder} />
      {delivery ? <input type="hidden" name="deliveryId" value={delivery.id} /> : null}
      <header>
        <div className="adminDeliveryEditorHeading">
          {delivery && CurrentIcon ? <CurrentIcon size={17} aria-hidden="true" /> : null}
          <span>
            <h3>{delivery ? delivery.title || DELIVERY_LABELS[delivery.kind] : "添加交付"}</h3>
            <p>{delivery ? "购买后按此内容交付。" : "选择一种交付方式。"}</p>
          </span>
        </div>
        {delivery ? (
          <button className="adminDangerIconButton" type="button" onClick={remove} aria-label="删除交付" title="删除">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {!delivery ? (
        <div className="adminDeliveryTypePicker" role="group" aria-label="交付方式">
          {DELIVERY_OPTIONS.map((option) => {
            const Icon = DELIVERY_ICONS[option.kind];
            const disabled = option.kind === "secret" && hasSecretDelivery;
            return (
              <button
                className={kind === option.kind ? "isActive" : ""}
                type="button"
                onClick={() => setKind(option.kind)}
                disabled={disabled}
                key={option.kind}
              >
                <Icon size={17} aria-hidden="true" />
                <span><strong>{option.label}</strong><small>{disabled ? "已配置" : option.description}</small></span>
              </button>
            );
          })}
        </div>
      ) : null}

      {kind ? (
        <div className="adminCommerceFieldGrid adminDeliveryFields">
          <label className="isFull">
            <span>显示名称（可选）</span>
            <input
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={DELIVERY_LABELS[kind]}
              maxLength={100}
            />
          </label>
          {kind === "text" ? (
            <label className="isFull"><span>购买后说明</span><textarea name="content" defaultValue={delivery?.kind === "text" ? delivery.content : ""} rows={8} required /></label>
          ) : null}
          {kind === "file" ? (
            <div className="isFull">
              <AdminMarketFilePicker
                productId={productId}
                assets={assets}
                selectedAssetId={delivery?.marketAssetId || null}
                onAssetUploaded={onAssetUploaded}
              />
            </div>
          ) : null}
          {kind === "secret" ? (
            delivery ? (
              <div className="isFull">
                <SecretStockEditor productId={productId} stock={stock} onStockChange={onStockChange} />
              </div>
            ) : <p className="adminDeliveryInlineHint isFull">保存后即可导入卡密库存。</p>
          ) : null}
          {kind === "entitlement" ? (
            <AdminEntitlementPicker initial={entitlement} />
          ) : null}
        </div>
      ) : null}

      <footer>
        <InlineMutationNotice notice={mutation.notice} />
        <button type="submit" disabled={mutation.pending || !kind}>
          <Save size={15} aria-hidden="true" />
          保存
        </button>
      </footer>
    </form>
  );
}

export function AdminMarketDeliveryManager({
  productId,
  deliveries: initialDeliveries,
  assets: initialAssets,
  stock: initialStock,
}: {
  productId: number;
  deliveries: MarketDeliveryItem[];
  assets: MarketAsset[];
  stock: number;
}) {
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [assets, setAssets] = useState(initialAssets);
  const [stock, setStock] = useState(initialStock);
  const [newVersion, setNewVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<number | "new">(
    initialDeliveries[0]?.id || "new",
  );
  const selected = selectedId === "new"
    ? null
    : deliveries.find((delivery) => delivery.id === selectedId) || null;
  const defaultSortOrder = deliveries.reduce(
    (highest, delivery) => Math.max(highest, delivery.sortOrder),
    0,
  ) + 10;

  function update(next: MarketDeliveryItem[]) {
    setDeliveries(next);
    if (selectedId === "new") setSelectedId(next.at(-1)?.id || "new");
    else if (!next.some((item) => item.id === selectedId)) setSelectedId(next[0]?.id || "new");
  }

  function addDelivery() {
    setSelectedId("new");
    setNewVersion((current) => current + 1);
  }

  function addAsset(asset: MarketAsset) {
    setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
  }

  return (
    <div className="adminDeliveryWorkspace">
      <aside className="adminDeliveryList">
        <header>
          <div><h2>交付内容</h2><small>{deliveries.length} 项</small></div>
          <button type="button" onClick={addDelivery} aria-label="添加交付" title="添加交付">
            <Plus size={15} aria-hidden="true" />
          </button>
        </header>
        {deliveries.length ? deliveries.map((delivery) => {
          const Icon = DELIVERY_ICONS[delivery.kind];
          const detail = delivery.kind === "file"
            ? delivery.asset?.fileName || "未选择文件"
            : delivery.kind === "secret"
              ? `库存 ${stock}`
              : delivery.kind === "text"
                ? "文字说明"
                : "站内权限";
          return (
            <button
              className={selectedId === delivery.id ? "isActive" : ""}
              type="button"
              onClick={() => setSelectedId(delivery.id)}
              key={delivery.id}
            >
              <Icon size={16} aria-hidden="true" />
              <span><strong>{delivery.title || DELIVERY_LABELS[delivery.kind]}</strong><small>{detail}</small></span>
            </button>
          );
        }) : (
          <p className="adminDeliveryEmpty">添加购买后需要交付的内容。</p>
        )}
      </aside>
      <DeliveryEditor
        key={selected ? selected.id : `new-${newVersion}`}
        productId={productId}
        delivery={selected}
        assets={assets}
        stock={stock}
        defaultSortOrder={defaultSortOrder}
        hasSecretDelivery={deliveries.some((delivery) => delivery.kind === "secret")}
        onSaved={update}
        onDeleted={update}
        onStockChange={setStock}
        onAssetUploaded={addAsset}
      />
    </div>
  );
}
