import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import {
  hashMutationPayload,
  MutationIdError,
  normalizeMutationId,
  normalizeMutationTarget,
} from "@/core/mutations/mutation-contract";
import { runPostgresIdempotentMutation } from "@/core/mutations/postgres-idempotency";
import { grantPostgresUserEntitlement } from "@/domains/access/postgres-entitlements";
import { decodeEntitlementDefinition } from "@/lib/entitlement-protocol";

export { MutationIdError };
export type UserCurrency = "soda" | "cookie";
export type CurrencyExchangeDirection = "cookie-to-soda" | "soda-to-cookie";
export type MarketProductStatus = "draft" | "published" | "archived";
export type MarketDeliveryKind = "text" | "secret" | "file" | "entitlement";

export type MarketProduct = {
  id: number; slug: string; title: string; description: string; status: MarketProductStatus;
  minLevel: number; priceCookie: number | null; priceSoda: number | null;
  purchaseLimitPerUser: number; sortOrder: number; coverKey: string | null;
  coverStorageNodeId: string | null; stock: number | null; deliveryCount: number;
  salesCount: number; createdAt: string; updatedAt: string;
};
export type MarketAsset = {
  id: number; productId: number; storageNodeId: string | null; fileName: string;
  storedName: string; mimeType: string; sizeBytes: number; mtimeMs: number; createdAt: string;
};
export type MarketDeliveryItem = {
  id: number; productId: number; kind: MarketDeliveryKind; title: string; content: string;
  marketAssetId: number | null; sortOrder: number; asset: MarketAsset | null;
};
export type MarketOrder = {
  id: number; orderNo: string; userId: number; productId: number | null; productTitle: string;
  currency: UserCurrency; amount: number; status: "paid" | "fulfilled" | "cancelled" | "refunded";
  createdAt: string; fulfilledAt: string | null;
};
export type MarketOrderDelivery = {
  id: number; orderId: number; kind: MarketDeliveryKind; title: string; content: string;
  marketAssetId: number | null; sortOrder: number; asset: MarketAsset | null;
};
export type RedemptionCodeBatch = {
  id: number; name: string; rewardType: "cookie" | "soda" | "product";
  rewardAmount: number; productId: number | null; status: "active" | "disabled";
  expiresAt: string | null; totalCodes: number; redeemedCodes: number; createdAt: string;
};

export class MarketError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "unavailable" | "level_required" |
    "purchase_limit" | "out_of_stock" | "insufficient_balance" | "configuration") {
    super(message);
    this.name = "MarketError";
  }
}

type ProductRow = QueryResultRow & {
  id: string | number; slug: string; title: string; description: string; status: MarketProductStatus;
  min_level: number; price_cookie: string | number | null; price_soda: string | number | null;
  purchase_limit_per_user: number; sort_order: number; cover_key: string | null;
  cover_storage_node_id: string | null; stock: string | number | null;
  delivery_count: string | number; sales_count: string | number; created_at: Date | string; updated_at: Date | string;
};
type AssetRow = QueryResultRow & {
  id: string | number; product_id: string | number; storage_node_id: string | null; file_name: string;
  stored_name: string; mime_type: string; size_bytes: string | number; mtime_ms: string | number; created_at: Date | string;
};
type DeliveryRow = QueryResultRow & {
  id: string | number; product_id?: string | number; order_id?: string | number; kind: MarketDeliveryKind;
  title: string; content: string; market_asset_id: string | number | null; sort_order: number;
  asset_id: string | number | null; asset_product_id: string | number | null; storage_node_id: string | null;
  file_name: string | null; stored_name: string | null; mime_type: string | null;
  size_bytes: string | number | null; mtime_ms: string | number | null; asset_created_at: Date | string | null;
};
type OrderRow = QueryResultRow & {
  id: string | number; order_no: string; user_id: string | number; product_id: string | number | null;
  product_title: string; currency: UserCurrency; amount: string | number; status: MarketOrder["status"];
  created_at: Date | string; fulfilled_at: Date | string | null;
};

function safeInteger(value: string | number, name: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid PostgreSQL market ${name}`);
  return parsed;
}
function id(value: string | number, name: string): number { return safeInteger(value, name, 1); }
function nullableInteger(value: string | number | null, name: string): number | null {
  return value === null ? null : safeInteger(value, name);
}
function timestamp(value: Date | string, name: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid PostgreSQL market ${name}`);
  return parsed.toISOString();
}
function nullableTimestamp(value: Date | string | null, name: string): string | null {
  return value === null ? null : timestamp(value, name);
}
function positiveId(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new MarketError(`${name}无效`, "invalid");
  return value;
}
function boundedInt(value: number | undefined | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}
function cleanText(value: string, max: number): string {
  if (!String(value).isWellFormed() || String(value).includes("\0")) throw new MarketError("文本格式无效", "invalid");
  return Array.from(String(value).normalize("NFKC").trim()).slice(0, max).join("");
}

const PRODUCT_SELECT = `SELECT p.id, p.slug, p.title, p.description, p.status, p.min_level,
  p.price_cookie, p.price_soda, p.purchase_limit_per_user, p.sort_order,
  p.cover_key, p.cover_storage_node_id,
  CASE WHEN EXISTS (SELECT 1 FROM market_delivery_items d WHERE d.product_id=p.id AND d.kind='secret')
    THEN (SELECT count(*)::bigint FROM market_secret_inventory s WHERE s.product_id=p.id AND s.status='available')
    ELSE NULL END AS stock,
  (SELECT count(*)::bigint FROM market_delivery_items d WHERE d.product_id=p.id) AS delivery_count,
  (SELECT count(*)::bigint FROM market_orders o WHERE o.product_id=p.id AND o.status='fulfilled') AS sales_count,
  p.created_at, p.updated_at FROM market_products p`;
const ASSET_SELECT = `SELECT id, product_id, storage_node_id, file_name, stored_name, mime_type, size_bytes, mtime_ms, created_at FROM market_assets`;
const ORDER_SELECT = `SELECT id, order_no, user_id, product_id, product_title, currency, amount, status, created_at, fulfilled_at FROM market_orders`;

function toProduct(row: ProductRow): MarketProduct {
  return { id: id(row.id, "product id"), slug: row.slug, title: row.title, description: row.description,
    status: row.status, minLevel: row.min_level, priceCookie: nullableInteger(row.price_cookie, "cookie price"),
    priceSoda: nullableInteger(row.price_soda, "soda price"), purchaseLimitPerUser: row.purchase_limit_per_user,
    sortOrder: row.sort_order, coverKey: row.cover_key, coverStorageNodeId: row.cover_storage_node_id,
    stock: nullableInteger(row.stock, "stock"), deliveryCount: safeInteger(row.delivery_count, "delivery count"),
    salesCount: safeInteger(row.sales_count, "sales count"), createdAt: timestamp(row.created_at, "product created timestamp"),
    updatedAt: timestamp(row.updated_at, "product updated timestamp") };
}
function toAsset(row: AssetRow): MarketAsset {
  return { id: id(row.id, "asset id"), productId: id(row.product_id, "asset product id"),
    storageNodeId: row.storage_node_id, fileName: row.file_name, storedName: row.stored_name, mimeType: row.mime_type,
    sizeBytes: safeInteger(row.size_bytes, "asset size", 1), mtimeMs: safeInteger(row.mtime_ms, "asset mtime"),
    createdAt: timestamp(row.created_at, "asset created timestamp") };
}
function toOrder(row: OrderRow): MarketOrder {
  return { id: id(row.id, "order id"), orderNo: row.order_no, userId: id(row.user_id, "order user id"),
    productId: row.product_id === null ? null : id(row.product_id, "order product id"), productTitle: row.product_title,
    currency: row.currency, amount: safeInteger(row.amount, "order amount"), status: row.status,
    createdAt: timestamp(row.created_at, "order created timestamp"), fulfilledAt: nullableTimestamp(row.fulfilled_at, "order fulfilled timestamp") };
}
function deliveryAsset(row: DeliveryRow): MarketAsset | null {
  if (row.asset_id === null || row.asset_product_id === null || !row.file_name || !row.stored_name || !row.mime_type ||
      row.size_bytes === null || row.mtime_ms === null || row.asset_created_at === null) return null;
  return toAsset({ id: row.asset_id, product_id: row.asset_product_id, storage_node_id: row.storage_node_id,
    file_name: row.file_name, stored_name: row.stored_name, mime_type: row.mime_type,
    size_bytes: row.size_bytes, mtime_ms: row.mtime_ms, created_at: row.asset_created_at });
}
function deliverySelect(table: "market_delivery_items" | "market_order_deliveries"): string {
  const product = table === "market_delivery_items" ? "d.product_id" : "a.product_id";
  return `SELECT d.*, a.id AS asset_id, ${product} AS asset_product_id, a.storage_node_id,
    a.file_name, a.stored_name, a.mime_type, a.size_bytes, a.mtime_ms, a.created_at AS asset_created_at
    FROM ${table} d LEFT JOIN market_assets a ON a.id=d.market_asset_id`;
}

export function normalizeMarketSlug(value: string): string | null {
  const slug = String(value).trim().toLocaleLowerCase("en-US").replace(/\s+/gu, "-");
  return /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/u.test(slug) ? slug : null;
}
function generatedMarketSlug(title: string): string {
  const ascii = title.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 72);
  return normalizeMarketSlug(ascii.length >= 3 ? ascii : ascii ? `item-${ascii}` : "") || `item-${crypto.randomBytes(5).toString("hex")}`;
}
async function uniqueMarketSlug(tx: SqlExecutor, value: string, title: string, excludeId = 0): Promise<string> {
  const explicit = value.trim();
  const base = explicit ? normalizeMarketSlug(explicit) : generatedMarketSlug(title);
  if (!base) throw new MarketError("链接标识格式无效", "invalid");
  await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended('market-slug', 0))" });
  const rows = await tx.query<QueryResultRow & { slug: string }>({ text: "SELECT slug FROM market_products WHERE id <> $1", values: [excludeId] });
  const occupied = new Set(rows.rows.map((row) => row.slug.toLocaleLowerCase("en-US")));
  if (!occupied.has(base)) return base;
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, 80 - suffixText.length)}${suffixText}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new MarketError("无法生成可用的商品链接", "invalid");
}

export function marketProductCoverUrl(product: Pick<MarketProduct, "id" | "coverKey">): string | null {
  return product.coverKey ? `/market/cover/${product.id}?v=${encodeURIComponent(product.coverKey)}` : null;
}
function marketSecret(): Buffer {
  const value = process.env.MARKET_SECRET_KEY || process.env.ADMIN_SESSION_SECRET || process.env.MEDIA_SIGNING_SECRET || "";
  if (value.length < 32) throw new MarketError("请先配置 MARKET_SECRET_KEY", "configuration");
  return crypto.createHash("sha256").update(value).digest();
}
function encryptSecret(value: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", marketSecret(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url"), authTag: cipher.getAuthTag().toString("base64url") };
}
function decryptSecret(ciphertext: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", marketSecret(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
function encryptedDeliveryValue(value: string): string {
  const encrypted = encryptSecret(value); return `enc:v1:${encrypted.iv}:${encrypted.authTag}:${encrypted.ciphertext}`;
}
export function revealOrderDeliveryContent(delivery: Pick<MarketOrderDelivery, "kind" | "content">): string {
  if (delivery.kind !== "secret" || !delivery.content.startsWith("enc:v1:")) return delivery.content;
  const [, version, iv, authTag, ciphertext] = delivery.content.split(":");
  if (version !== "v1" || !iv || !authTag || !ciphertext) return "";
  try { return decryptSecret(ciphertext, iv, authTag); } catch { return ""; }
}
function codeHash(value: string): string { return crypto.createHmac("sha256", marketSecret()).update(value).digest("hex"); }
function normalizeCode(value: string): string { return value.trim().toLocaleUpperCase("en-US").replace(/\s+/gu, ""); }
function randomCode(prefix: string): string {
  const raw = crypto.randomBytes(15).toString("base64url").toLocaleUpperCase("en-US").replace(/[-_]/gu, "X");
  return `${prefix}-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

export async function listPostgresMarketProducts(executor: SqlExecutor, options: { includeUnpublished?: boolean } = {}): Promise<MarketProduct[]> {
  const result = await executor.query<ProductRow>({ text: `${PRODUCT_SELECT} WHERE p.deleted_at IS NULL ${options.includeUnpublished ? "" : "AND p.status='published'"}
    ORDER BY p.sort_order ASC, p.updated_at DESC, p.id DESC` });
  return result.rows.map(toProduct);
}
export async function getPostgresMarketProductById(executor: SqlExecutor, productId: number): Promise<MarketProduct | null> {
  const result = await executor.query<ProductRow>({ text: `${PRODUCT_SELECT} WHERE p.id=$1 AND p.deleted_at IS NULL`, values: [positiveId(productId, "商品")] });
  return result.rows[0] ? toProduct(result.rows[0]) : null;
}
export async function getPostgresMarketProductBySlug(executor: SqlExecutor, value: string): Promise<MarketProduct | null> {
  const slug = normalizeMarketSlug(value); if (!slug) return null;
  const result = await executor.query<ProductRow>({ text: `${PRODUCT_SELECT} WHERE lower(p.slug)=$1 AND p.deleted_at IS NULL`, values: [slug] });
  return result.rows[0] ? toProduct(result.rows[0]) : null;
}

export async function createPostgresMarketProduct(input: { slug: string; title: string; description?: string; minLevel?: number;
  priceCookie?: number | null; priceSoda?: number | null; purchaseLimitPerUser?: number; sortOrder?: number }): Promise<number> {
  const title = cleanText(input.title, 120); if (!title) throw new MarketError("请输入商品名称", "invalid");
  if (input.priceCookie != null && input.priceSoda != null) throw new MarketError("商品只能选择一种支付方式", "invalid");
  return withTransaction(async (tx) => {
    const slug = await uniqueMarketSlug(tx, input.slug, title);
    const result = await tx.query<QueryResultRow & { id: string | number }>({ text: `INSERT INTO market_products
      (slug,title,description,min_level,price_cookie,price_soda,purchase_limit_per_user,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, values: [slug, title, cleanText(input.description || "", 20_000),
      boundedInt(input.minLevel, 1, 1, 6), input.priceCookie == null ? null : boundedInt(input.priceCookie, 0, 0, 2_000_000_000),
      input.priceSoda == null ? null : boundedInt(input.priceSoda, 0, 0, 2_000_000_000),
      boundedInt(input.purchaseLimitPerUser, 1, 0, 10_000), boundedInt(input.sortOrder, 0, -1_000_000, 1_000_000)] });
    return id(result.rows[0]!.id, "created product id");
  }, { isolation: "serializable" });
}
export async function updatePostgresMarketProduct(input: { id: number; slug: string; title: string; description?: string;
  status: MarketProductStatus; minLevel: number; priceCookie: number | null; priceSoda: number | null;
  purchaseLimitPerUser: number; sortOrder: number }): Promise<boolean> {
  const productId = positiveId(input.id, "商品"); const title = cleanText(input.title, 120);
  if (!title || !["draft", "published", "archived"].includes(input.status)) throw new MarketError("商品参数无效", "invalid");
  const priceCount = Number(input.priceCookie != null) + Number(input.priceSoda != null);
  if (priceCount > 1 || (input.status === "published" && priceCount !== 1)) throw new MarketError("商品只能选择一种支付方式", "invalid");
  return withTransaction(async (tx) => {
    const slug = await uniqueMarketSlug(tx, input.slug, title, productId);
    const result = await tx.query({ text: `UPDATE market_products SET slug=$2,title=$3,description=$4,status=$5,min_level=$6,
      price_cookie=$7,price_soda=$8,purchase_limit_per_user=$9,sort_order=$10,updated_at=clock_timestamp()
      WHERE id=$1 AND deleted_at IS NULL`, values: [productId,slug,title,cleanText(input.description || "",20_000),input.status,
      boundedInt(input.minLevel,1,1,6),input.priceCookie == null ? null : boundedInt(input.priceCookie,0,0,2_000_000_000),
      input.priceSoda == null ? null : boundedInt(input.priceSoda,0,0,2_000_000_000),
      boundedInt(input.purchaseLimitPerUser,1,0,10_000),boundedInt(input.sortOrder,0,-1_000_000,1_000_000)] });
    return result.rowCount === 1;
  }, { isolation: "serializable" });
}
export async function setPostgresMarketProductStatus(executor: SqlExecutor, productId: number, status: "published" | "archived"): Promise<boolean> {
  const result = await executor.query({ text: "UPDATE market_products SET status=$2,updated_at=clock_timestamp() WHERE id=$1 AND deleted_at IS NULL",
    values: [positiveId(productId,"商品"),status] }); return result.rowCount === 1;
}
export async function replacePostgresMarketProductCover(executor: SqlExecutor, productId: number,
  cover: { key: string; storageNodeId: string | null } | null): Promise<{ key: string; storageNodeId: string | null } | undefined> {
  if (cover && !/^[a-f0-9]{32}$/u.test(cover.key)) throw new MarketError("封面标识无效", "invalid");
  const result = await executor.query<QueryResultRow & { old_key: string | null; old_node: string | null }>({ text: `WITH current AS MATERIALIZED (
      SELECT id, cover_key, cover_storage_node_id FROM market_products
      WHERE id=$1 AND deleted_at IS NULL FOR UPDATE
    )
    UPDATE market_products product
    SET cover_key=$2,cover_storage_node_id=$3,updated_at=clock_timestamp()
    FROM current WHERE product.id=current.id
    RETURNING current.cover_key AS old_key, current.cover_storage_node_id AS old_node`,
    values: [positiveId(productId,"商品"),cover?.key || null,cover?.storageNodeId || null] });
  const row = result.rows[0]; return row?.old_key ? { key: row.old_key, storageNodeId: row.old_node } : row ? undefined : undefined;
}
export async function deletePostgresMarketProduct(executor: SqlExecutor, productId: number): Promise<boolean> {
  const result = await executor.query({ text: `UPDATE market_products SET status='archived',deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=$1 AND deleted_at IS NULL`, values:[positiveId(productId,"商品")] }); return result.rowCount === 1;
}

export async function listPostgresMarketAssets(executor: SqlExecutor, productId: number): Promise<MarketAsset[]> {
  const result = await executor.query<AssetRow>({ text: `${ASSET_SELECT} WHERE product_id=$1 ORDER BY id DESC`, values:[positiveId(productId,"商品")] });
  return result.rows.map(toAsset);
}
export async function getPostgresMarketAssetById(executor: SqlExecutor, assetId: number): Promise<MarketAsset | null> {
  const result = await executor.query<AssetRow>({ text: `${ASSET_SELECT} WHERE id=$1`, values:[positiveId(assetId,"文件")] });
  return result.rows[0] ? toAsset(result.rows[0]) : null;
}
export async function upsertPostgresMarketAsset(input: { productId:number; storageNodeId:string|null; fileName:string; storedName:string;
  mimeType:string; sizeBytes:number; mtimeMs:number }): Promise<MarketAsset> {
  return withTransaction(async (tx) => {
    await tx.query({ text:"SELECT pg_advisory_xact_lock(hashtextextended('market-asset:' || coalesce($1,'local') || ':' || $2,0))", values:[input.storageNodeId,input.storedName] });
    const existing = await tx.query<AssetRow>({ text:`${ASSET_SELECT} WHERE storage_node_id IS NOT DISTINCT FROM $1 AND stored_name=$2`, values:[input.storageNodeId,input.storedName] });
    if (existing.rows[0]) return toAsset(existing.rows[0]);
    const inserted = await tx.query<AssetRow>({ text:`INSERT INTO market_assets (product_id,storage_node_id,file_name,stored_name,mime_type,size_bytes,mtime_ms)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,product_id,storage_node_id,file_name,stored_name,mime_type,size_bytes,mtime_ms,created_at`,
      values:[positiveId(input.productId,"商品"),input.storageNodeId,cleanText(input.fileName,180),cleanText(input.storedName,500),cleanText(input.mimeType,100),
      safeInteger(input.sizeBytes,"asset size",1),safeInteger(input.mtimeMs,"asset mtime")] });
    return toAsset(inserted.rows[0]!);
  }, { isolation:"serializable" });
}
export async function userOwnsPostgresMarketAsset(executor: SqlExecutor,userId:number,orderId:number,assetId:number):Promise<boolean>{
  const result=await executor.query<QueryResultRow&{found:boolean}>({text:`SELECT EXISTS(SELECT 1 FROM market_orders o JOIN market_order_deliveries d ON d.order_id=o.id
    WHERE o.id=$1 AND o.user_id=$2 AND o.status='fulfilled' AND d.kind='file' AND d.market_asset_id=$3) AS found`,values:[positiveId(orderId,"订单"),positiveId(userId,"用户"),positiveId(assetId,"文件")]});
  return result.rows[0]?.found===true;
}

export async function listPostgresMarketDeliveryItems(executor:SqlExecutor,productId:number):Promise<MarketDeliveryItem[]>{
  const result=await executor.query<DeliveryRow>({text:`${deliverySelect("market_delivery_items")} WHERE d.product_id=$1 ORDER BY d.sort_order,d.id`,values:[positiveId(productId,"商品")]});
  return result.rows.map(row=>({id:id(row.id,"delivery id"),productId:id(row.product_id!,"delivery product id"),kind:row.kind,title:row.title,
    content:row.content,marketAssetId:row.market_asset_id===null?null:id(row.market_asset_id,"delivery asset id"),sortOrder:row.sort_order,asset:deliveryAsset(row)}));
}
export async function savePostgresMarketDeliveryItem(input:{id?:number;productId:number;kind:MarketDeliveryKind;title?:string;content?:string;
  marketAssetId?:number|null;sortOrder?:number}):Promise<number>{
  if(!["text","secret","file","entitlement"].includes(input.kind))throw new MarketError("交付类型无效","invalid");
  return withTransaction(async tx=>{
    const productId=positiveId(input.productId,"商品"); await tx.query({text:"SELECT id FROM market_products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",values:[productId]});
    if(input.kind==="secret"){
      const duplicate=await tx.query({text:"SELECT id FROM market_delivery_items WHERE product_id=$1 AND kind='secret' AND id<>$2",values:[productId,input.id||0]});
      if(duplicate.rows[0])throw new MarketError("每个商品只能配置一项卡密交付","invalid");
    }
    const assetId=input.kind==="file"&&input.marketAssetId?positiveId(input.marketAssetId,"文件"):null;
    if(input.kind==="file"&&!assetId)throw new MarketError("请选择需要交付的文件","invalid");
    if(assetId){const asset=await tx.query({text:"SELECT id FROM market_assets WHERE id=$1 AND product_id=$2",values:[assetId,productId]});if(!asset.rows[0])throw new MarketError("交付文件不存在","not_found");}
    const values=[productId,input.kind,cleanText(input.title||"",100),cleanText(input.content||"",100_000),assetId,boundedInt(input.sortOrder,0,-1_000_000,1_000_000)];
    if(input.id){const itemId=positiveId(input.id,"交付项");const result=await tx.query({text:`UPDATE market_delivery_items SET kind=$2,title=$3,content=$4,market_asset_id=$5,sort_order=$6,updated_at=clock_timestamp()
      WHERE id=$7 AND product_id=$1`,values:[...values,itemId]});if(result.rowCount!==1)throw new MarketError("交付项不存在","not_found");return itemId;}
    const result=await tx.query<QueryResultRow&{id:string|number}>({text:`INSERT INTO market_delivery_items(product_id,kind,title,content,market_asset_id,sort_order)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,values});return id(result.rows[0]!.id,"created delivery id");
  },{isolation:"serializable"});
}
export async function deletePostgresMarketDeliveryItem(executor:SqlExecutor,productId:number,itemId:number):Promise<boolean>{
  const result=await executor.query({text:"DELETE FROM market_delivery_items WHERE id=$1 AND product_id=$2",values:[positiveId(itemId,"交付项"),positiveId(productId,"商品")]});return result.rowCount===1;
}
export async function importPostgresMarketSecrets(productIdValue:number,values:readonly string[]):Promise<number>{
  const unique=[...new Set(values.map(value=>cleanText(value,4_000)).filter(Boolean))].slice(0,10_000);if(!unique.length)return 0;
  const encrypted=unique.map(encryptSecret);return withTransaction(async tx=>{const productId=positiveId(productIdValue,"商品");
    const product=await tx.query({text:"SELECT id FROM market_products WHERE id=$1 AND deleted_at IS NULL FOR SHARE",values:[productId]});if(!product.rows[0])throw new MarketError("商品不存在","not_found");
    const result=await tx.query({text:`INSERT INTO market_secret_inventory(product_id,ciphertext,iv,auth_tag)
      SELECT $1,item.ciphertext,item.iv,item.auth_tag FROM jsonb_to_recordset($2::jsonb) AS item(ciphertext text,iv text,auth_tag text)`,
      values:[productId,JSON.stringify(encrypted.map(item=>({ciphertext:item.ciphertext,iv:item.iv,auth_tag:item.authTag})))]});return result.rowCount??0;
  },{isolation:"repeatable read"});
}

export async function listPostgresUserMarketOrders(executor:SqlExecutor,userId:number,limit=100):Promise<MarketOrder[]>{
  const result=await executor.query<OrderRow>({text:`${ORDER_SELECT} WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,values:[positiveId(userId,"用户"),boundedInt(limit,100,1,200)]});return result.rows.map(toOrder);
}
export async function listPostgresAdminMarketOrders(executor:SqlExecutor,limit=100):Promise<MarketOrder[]>{
  const result=await executor.query<OrderRow>({text:`${ORDER_SELECT} WHERE admin_deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $1`,values:[boundedInt(limit,100,1,500)]});return result.rows.map(toOrder);
}
export async function removePostgresAdminMarketOrder(executor:SqlExecutor,orderId:number):Promise<boolean>{const result=await executor.query({text:"UPDATE market_orders SET admin_deleted_at=clock_timestamp() WHERE id=$1 AND admin_deleted_at IS NULL",values:[positiveId(orderId,"订单")]});return result.rowCount===1;}
export async function getPostgresUserMarketOrder(executor:SqlExecutor,userId:number,orderNoValue:string):Promise<MarketOrder|null>{
  const orderNo=cleanText(orderNoValue,80);if(!orderNo)return null;const result=await executor.query<OrderRow>({text:`${ORDER_SELECT} WHERE user_id=$1 AND order_no=$2`,values:[positiveId(userId,"用户"),orderNo]});return result.rows[0]?toOrder(result.rows[0]):null;
}
export async function listPostgresMarketOrderDeliveries(executor:SqlExecutor,orderId:number):Promise<MarketOrderDelivery[]>{
  const result=await executor.query<DeliveryRow>({text:`${deliverySelect("market_order_deliveries")} WHERE d.order_id=$1 ORDER BY d.sort_order,d.id`,values:[positiveId(orderId,"订单")]});
  return result.rows.map(row=>({id:id(row.id,"order delivery id"),orderId:id(row.order_id!,"delivery order id"),kind:row.kind,title:row.title,content:row.content,
    marketAssetId:row.market_asset_id===null?null:id(row.market_asset_id,"delivery asset id"),sortOrder:row.sort_order,asset:deliveryAsset(row)}));
}

function mutationContract(userId:number,mutationId:string,operation:string,target:string,payload:unknown){return{mutationId:normalizeMutationId(mutationId),userId,
  operation,target:normalizeMutationTarget(target),payloadHash:hashMutationPayload(payload)};}
function purchasePrice(product:ProductRow,currency:UserCurrency):number|null{return currency==="cookie"?nullableInteger(product.price_cookie,"cookie price"):nullableInteger(product.price_soda,"soda price");}
function orderNo():string{return `M${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;}

async function createOrder(tx:SqlExecutor,input:{userId:number;product:ProductRow;currency:UserCurrency;amount:number;charge:boolean;referenceKey:string}):Promise<MarketOrder>{
  const deliveries=await tx.query<QueryResultRow&{id:string|number;kind:MarketDeliveryKind;title:string;content:string;market_asset_id:string|number|null;sort_order:number}>({text:`SELECT id,kind,title,content,market_asset_id,sort_order FROM market_delivery_items WHERE product_id=$1 ORDER BY sort_order,id FOR SHARE`,values:[input.product.id]});
  if(!deliveries.rows.length)throw new MarketError("商品尚未配置交付内容","unavailable");
  let balance=0;
  if(input.charge&&input.amount>0){const column=input.currency==="cookie"?"cookie_balance":"soda_balance";
    const current=await tx.query<QueryResultRow&{balance:string|number}>({text:`SELECT ${column} AS balance FROM users WHERE id=$1 FOR UPDATE`,values:[input.userId]});
    if(!current.rows[0])throw new MarketError("用户不可用","invalid");balance=safeInteger(current.rows[0].balance,"balance");
    if(balance<input.amount)throw new MarketError(input.currency==="cookie"?"曲奇不足":"苏打不足","insufficient_balance");balance-=input.amount;
    await tx.query({text:`UPDATE users SET ${column}=$2,updated_at=clock_timestamp() WHERE id=$1`,values:[input.userId,balance]});
  }
  const number=orderNo();const inserted=await tx.query<OrderRow>({text:`INSERT INTO market_orders(order_no,user_id,product_id,product_title,currency,amount,status)
    VALUES($1,$2,$3,$4,$5,$6,'paid') RETURNING id,order_no,user_id,product_id,product_title,currency,amount,status,created_at,fulfilled_at`,values:[number,input.userId,input.product.id,input.product.title,input.currency,input.amount]});
  const order=toOrder(inserted.rows[0]!);
  if(input.charge&&input.amount>0)await tx.query({text:`INSERT INTO user_currency_transactions(user_id,currency,amount,balance_after,source,reference_key,note)
    VALUES($1,$2,$3,$4,'market_purchase',$5,$6)`,values:[input.userId,input.currency,-input.amount,balance,input.referenceKey,`购买「${input.product.title.slice(0,100)}」`]});
  for(const delivery of deliveries.rows){let content=delivery.content;
    if(delivery.kind==="secret"){const secret=await tx.query<QueryResultRow&{id:string|number;ciphertext:string;iv:string;auth_tag:string}>({text:`SELECT id,ciphertext,iv,auth_tag FROM market_secret_inventory
      WHERE product_id=$1 AND status='available' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,values:[input.product.id]});const selected=secret.rows[0];if(!selected)throw new MarketError("卡密库存不足","out_of_stock");
      content=encryptedDeliveryValue(decryptSecret(selected.ciphertext,selected.iv,selected.auth_tag));const claimed=await tx.query({text:`UPDATE market_secret_inventory SET status='delivered',order_id=$2,delivered_at=clock_timestamp()
        WHERE id=$1 AND status='available'`,values:[selected.id,order.id]});if(claimed.rowCount!==1)throw new MarketError("卡密库存不足","out_of_stock");}
    await tx.query({text:`INSERT INTO market_order_deliveries(order_id,kind,title,content,market_asset_id,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,values:[order.id,delivery.kind,delivery.title,content,delivery.market_asset_id,delivery.sort_order]});
    if(delivery.kind==="entitlement"){const definition=decodeEntitlementDefinition(delivery.content);if(!definition)throw new MarketError("商品权益配置无效","configuration");
      const granted=await grantPostgresUserEntitlement({userId:input.userId,definition,sourceOrderId:order.id,grantedBy:"market"},operation=>operation(tx));if(!granted)throw new MarketError("商品权益目标不存在","configuration");}
  }
  const fulfilled=await tx.query<OrderRow>({text:`UPDATE market_orders SET status='fulfilled',fulfilled_at=clock_timestamp() WHERE id=$1
    RETURNING id,order_no,user_id,product_id,product_title,currency,amount,status,created_at,fulfilled_at`,values:[order.id]});return toOrder(fulfilled.rows[0]!);
}

export async function purchasePostgresMarketProduct(input:{userId:number;productId:number;currency:UserCurrency;mutationId:string}):Promise<MarketOrder>{
  const userId=positiveId(input.userId,"用户"),productId=positiveId(input.productId,"商品");if(input.currency!=="cookie"&&input.currency!=="soda")throw new MarketError("支付方式无效","invalid");
  const contract=mutationContract(userId,input.mutationId,"market.purchase",`product:${productId}`,{currency:input.currency});
  return runPostgresIdempotentMutation(contract,async tx=>{await tx.query({text:"SELECT pg_advisory_xact_lock(hashtextextended('market-purchase:' || $1 || ':' || $2,0))",values:[userId,productId]});
    const user=await tx.query<QueryResultRow&{status:string;trust_level:number}>({text:"SELECT status,trust_level FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",values:[userId]});
    const products=await tx.query<ProductRow>({text:`${PRODUCT_SELECT} WHERE p.id=$1 AND p.deleted_at IS NULL`,values:[productId]});const product=products.rows[0];
    if(!user.rows[0]||user.rows[0].status!=="active"||!product)throw new MarketError("商品不存在","not_found");if(product.status!=="published")throw new MarketError("商品暂不可购买","unavailable");
    if(user.rows[0].trust_level<product.min_level)throw new MarketError(`达到 Lv.${product.min_level} 后可购买`,"level_required");const price=purchasePrice(product,input.currency);if(price===null)throw new MarketError("该商品不支持此支付方式","invalid");
    if(product.purchase_limit_per_user>0){const count=await tx.query<QueryResultRow&{count:string|number}>({text:"SELECT count(*)::bigint AS count FROM market_orders WHERE user_id=$1 AND product_id=$2 AND status='fulfilled'",values:[userId,productId]});
      if(safeInteger(count.rows[0]!.count,"purchase count")>=product.purchase_limit_per_user)throw new MarketError("已达到该商品的购买次数上限","purchase_limit");}
    return createOrder(tx,{userId,product,currency:input.currency,amount:price,charge:true,referenceKey:`market-purchase:${contract.mutationId}`});
  });
}

export async function createPostgresRedemptionCodeBatch(input:{name:string;rewardType:"cookie"|"soda"|"product";rewardAmount?:number;productId?:number|null;count:number;expiresAt?:string|null}):Promise<{batchId:number;codes:string[]}>{
  const count=boundedInt(input.count,1,1,5_000);if(input.rewardType==="product"&&!input.productId)throw new MarketError("请选择兑换商品","invalid");
  const expires=input.expiresAt&&Number.isFinite(Date.parse(input.expiresAt))?new Date(input.expiresAt):null;
  return withTransaction(async tx=>{const batch=await tx.query<QueryResultRow&{id:string|number}>({text:`INSERT INTO redemption_code_batches(name,reward_type,reward_amount,product_id,expires_at)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,values:[cleanText(input.name,100)||"兑换码",input.rewardType,input.rewardType==="product"?0:boundedInt(input.rewardAmount,1,1,2_000_000_000),input.rewardType==="product"?positiveId(input.productId!,"商品"):null,expires]});
    const batchId=id(batch.rows[0]!.id,"batch id"),prefix=input.rewardType==="cookie"?"CK":input.rewardType==="soda"?"SD":"PR",codes:string[]=[];
    while(codes.length<count){const candidates=Array.from({length:Math.min(count-codes.length,1000)},()=>randomCode(prefix));const result=await tx.query<QueryResultRow&{code_hash:string}>({text:`INSERT INTO redemption_codes(batch_id,code_hash,code_hint)
      SELECT $1,item.code_hash,item.code_hint FROM jsonb_to_recordset($2::jsonb) AS item(code_hash text,code_hint text) ON CONFLICT(code_hash) DO NOTHING RETURNING code_hash`,values:[batchId,JSON.stringify(candidates.map(code=>({code_hash:codeHash(code),code_hint:code.slice(-6)})))]});
      const inserted=new Set(result.rows.map(row=>row.code_hash));for(const code of candidates)if(inserted.has(codeHash(code)))codes.push(code);}
    return{batchId,codes};
  },{isolation:"serializable"});
}

export async function redeemPostgresMarketCode(userIdValue:number,codeValue:string,mutationId:string):Promise<{rewardType:"cookie"|"soda"|"product";amount:number;orderNo?:string}>{
  const userId=positiveId(userIdValue,"用户"),normalized=normalizeCode(codeValue);if(normalized.length<10)throw new MarketError("兑换码无效","invalid");const hash=codeHash(normalized);
  const contract=mutationContract(userId,mutationId,"market.redeem",`redemption-code:${hash}`,{code:normalized});return runPostgresIdempotentMutation(contract,async tx=>{
    const found=await tx.query<QueryResultRow&{id:string|number;status:string;batch_status:string;reward_type:"cookie"|"soda"|"product";reward_amount:string|number;product_id:string|number|null;expires_at:Date|string|null}>({text:`SELECT c.id,c.status,b.status AS batch_status,b.reward_type,b.reward_amount,b.product_id,b.expires_at FROM redemption_codes c JOIN redemption_code_batches b ON b.id=c.batch_id WHERE c.code_hash=$1 FOR UPDATE OF c`,values:[hash]});const row=found.rows[0];
    if(!row||row.status!=="available"||row.batch_status!=="active"||(row.expires_at&&new Date(row.expires_at).getTime()<=Date.now()))throw new MarketError("兑换码无效或已使用","unavailable");
    const users=await tx.query<QueryResultRow&{status:string;soda_balance:string|number;cookie_balance:string|number}>({text:"SELECT status,soda_balance,cookie_balance FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",values:[userId]});const user=users.rows[0];if(!user||user.status!=="active")throw new MarketError("用户不可用","invalid");
    const amount=safeInteger(row.reward_amount,"reward amount");let result:{rewardType:"cookie"|"soda"|"product";amount:number;orderNo?:string}={rewardType:row.reward_type,amount};
    if(row.reward_type==="product"){if(row.product_id===null)throw new MarketError("兑换商品已下架","unavailable");const products=await tx.query<ProductRow>({text:`${PRODUCT_SELECT} WHERE p.id=$1 AND p.deleted_at IS NULL`,values:[row.product_id]});if(!products.rows[0])throw new MarketError("兑换商品已下架","unavailable");
      const order=await createOrder(tx,{userId,product:products.rows[0],currency:"cookie",amount:0,charge:false,referenceKey:`market-redeem:${contract.mutationId}`});result={...result,orderNo:order.orderNo};
    }else{const column=row.reward_type==="cookie"?"cookie_balance":"soda_balance",current=safeInteger(row.reward_type==="cookie"?user.cookie_balance:user.soda_balance,"balance"),balance=current+amount;if(!Number.isSafeInteger(balance)||balance>2_000_000_000)throw new MarketError(`${row.reward_type==="cookie"?"曲奇":"苏打"}余额已达上限`,"invalid");
      await tx.query({text:`UPDATE users SET ${column}=$2,updated_at=clock_timestamp() WHERE id=$1`,values:[userId,balance]});await tx.query({text:`INSERT INTO user_currency_transactions(user_id,currency,amount,balance_after,source,reference_key,note)
        VALUES($1,$2,$3,$4,'redemption_code',$5,'兑换码充值')`,values:[userId,row.reward_type,amount,balance,`market-redeem:${contract.mutationId}`]});}
    const claimed=await tx.query({text:"UPDATE redemption_codes SET status='redeemed',redeemed_by=$2,redeemed_at=clock_timestamp() WHERE id=$1 AND status='available'",values:[row.id,userId]});if(claimed.rowCount!==1)throw new MarketError("兑换码无效或已使用","unavailable");return result;
  });
}

export async function exchangePostgresUserCurrency(input:{userId:number;direction:CurrencyExchangeDirection;sourceAmount:number;sodaPerCookie:number;mutationId:string}):Promise<{cookieBalance:number;sodaBalance:number;receivedAmount:number}>{
  const sourceAmount=Number(input.sourceAmount),rate=Number(input.sodaPerCookie);if(!Number.isSafeInteger(sourceAmount)||sourceAmount<1||sourceAmount>1_000_000)throw new Error("请输入有效兑换数量");if(!Number.isSafeInteger(rate)||rate<1||rate>10_000)throw new Error("兑换比例无效");
  if(input.direction!=="cookie-to-soda"&&input.direction!=="soda-to-cookie")throw new Error("兑换方向无效");if(input.direction==="soda-to-cookie"&&sourceAmount%rate!==0)throw new Error(`苏打数量须为 ${rate} 的倍数`);
  const cookieDelta=input.direction==="cookie-to-soda"?-sourceAmount:sourceAmount/rate,sodaDelta=input.direction==="cookie-to-soda"?sourceAmount*rate:-sourceAmount,receivedAmount=input.direction==="cookie-to-soda"?sodaDelta:cookieDelta;
  if(!Number.isSafeInteger(receivedAmount)||receivedAmount>2_000_000_000)throw new Error("兑换数量过大");const userId=positiveId(input.userId,"用户");const contract=mutationContract(userId,input.mutationId,"market.exchange",`currency-exchange:${input.direction}`,{sourceAmount,sodaPerCookie:rate});
  return runPostgresIdempotentMutation(contract,async tx=>{const users=await tx.query<QueryResultRow&{status:string;cookie_balance:string|number;soda_balance:string|number;soda_experience:string|number}>({text:"SELECT status,cookie_balance,soda_balance,soda_experience FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",values:[userId]});const user=users.rows[0];if(!user||user.status!=="active")throw new Error("用户不可用");
    const currentCookie=safeInteger(user.cookie_balance,"cookie balance"),currentSoda=safeInteger(user.soda_balance,"soda balance"),experience=safeInteger(user.soda_experience,"soda experience");if(cookieDelta<0&&currentCookie< -cookieDelta)throw new Error("曲奇不足");if(sodaDelta<0&&currentSoda< -sodaDelta)throw new Error("苏打不足");
    const cookieBalance=currentCookie+cookieDelta,sodaBalance=currentSoda+sodaDelta,sodaExperience=experience+Math.max(sodaDelta,0);if(cookieBalance>2_000_000_000)throw new Error("曲奇余额已达上限");if(sodaBalance>2_000_000_000||sodaExperience>2_000_000_000)throw new Error("苏打余额已达上限");
    const level=await tx.query<QueryResultRow&{level:number}>({text:"SELECT level FROM user_levels WHERE soda_required<=$1 ORDER BY level DESC LIMIT 1",values:[sodaExperience]});
    await tx.query({text:"UPDATE users SET cookie_balance=$2,soda_balance=$3,soda_experience=$4,trust_level=$5,updated_at=clock_timestamp() WHERE id=$1",values:[userId,cookieBalance,sodaBalance,sodaExperience,level.rows[0]?.level??1]});
    const sourceCurrency:UserCurrency=input.direction==="cookie-to-soda"?"cookie":"soda",targetCurrency:UserCurrency=sourceCurrency==="cookie"?"soda":"cookie",sourceBalance=sourceCurrency==="cookie"?cookieBalance:sodaBalance,targetBalance=targetCurrency==="cookie"?cookieBalance:sodaBalance;
    await tx.query({text:`INSERT INTO user_currency_transactions(user_id,currency,amount,balance_after,source,reference_key,note) VALUES
      ($1,$2,$3,$4,'currency_exchange',$5,$6),($1,$7,$8,$9,'currency_exchange',$10,$11)`,values:[userId,sourceCurrency,-sourceAmount,sourceBalance,`market-exchange:${contract.mutationId}:${sourceCurrency}`,`兑换 ${receivedAmount} ${targetCurrency==="cookie"?"曲奇":"苏打"}`,targetCurrency,receivedAmount,targetBalance,`market-exchange:${contract.mutationId}:${targetCurrency}`,`由 ${sourceAmount} ${sourceCurrency==="cookie"?"曲奇":"苏打"}兑换`]});
    return{cookieBalance,sodaBalance,receivedAmount};
  });
}

export async function listPostgresRedemptionCodeBatches(executor:SqlExecutor,limit=100):Promise<RedemptionCodeBatch[]>{const result=await executor.query<QueryResultRow&{id:string|number;name:string;reward_type:RedemptionCodeBatch["rewardType"];reward_amount:string|number;product_id:string|number|null;status:RedemptionCodeBatch["status"];expires_at:Date|string|null;total_codes:string|number;redeemed_codes:string|number;created_at:Date|string}>({text:`SELECT b.id,b.name,b.reward_type,b.reward_amount,b.product_id,b.status,b.expires_at,b.created_at,count(c.id)::bigint AS total_codes,count(c.id) FILTER(WHERE c.status='redeemed')::bigint AS redeemed_codes FROM redemption_code_batches b LEFT JOIN redemption_codes c ON c.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC,b.id DESC LIMIT $1`,values:[boundedInt(limit,100,1,500)]});return result.rows.map(row=>({id:id(row.id,"batch id"),name:row.name,rewardType:row.reward_type,rewardAmount:safeInteger(row.reward_amount,"reward amount"),productId:row.product_id===null?null:id(row.product_id,"reward product id"),status:row.status,expiresAt:nullableTimestamp(row.expires_at,"batch expiry"),totalCodes:safeInteger(row.total_codes,"code count"),redeemedCodes:safeInteger(row.redeemed_codes,"redeemed count"),createdAt:timestamp(row.created_at,"batch created timestamp")}));}
