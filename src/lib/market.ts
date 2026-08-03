import crypto from "node:crypto";
import { getDb } from "./db";
import {
  decodeEntitlementDefinition,
  grantUserEntitlement,
} from "./entitlements";
import type { UserCurrency } from "./user-wallet";

export type MarketProductStatus = "draft" | "published" | "archived";
export type MarketDeliveryKind = "text" | "secret" | "file" | "entitlement";

export type MarketProduct = {
  id: number;
  slug: string;
  title: string;
  description: string;
  status: MarketProductStatus;
  minLevel: number;
  priceCookie: number | null;
  priceSoda: number | null;
  purchaseLimitPerUser: number;
  sortOrder: number;
  coverKey: string | null;
  coverStorageNodeId: string | null;
  stock: number | null;
  deliveryCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MarketAsset = {
  id: number;
  productId: number;
  storageNodeId: string | null;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  createdAt: string;
};

export type MarketDeliveryItem = {
  id: number;
  productId: number;
  kind: MarketDeliveryKind;
  title: string;
  content: string;
  marketAssetId: number | null;
  sortOrder: number;
  asset: MarketAsset | null;
};

export type MarketOrder = {
  id: number;
  orderNo: string;
  userId: number;
  productId: number | null;
  productTitle: string;
  currency: UserCurrency;
  amount: number;
  status: "paid" | "fulfilled" | "cancelled" | "refunded";
  createdAt: string;
  fulfilledAt: string | null;
};

export type MarketOrderDelivery = {
  id: number;
  orderId: number;
  kind: MarketDeliveryKind;
  title: string;
  content: string;
  marketAssetId: number | null;
  sortOrder: number;
  asset: MarketAsset | null;
};

type ProductRow = {
  id: number;
  slug: string;
  title: string;
  description: string;
  status: MarketProductStatus;
  min_level: number;
  price_cookie: number | null;
  price_soda: number | null;
  purchase_limit_per_user: number;
  sort_order: number;
  cover_key: string | null;
  cover_storage_node_id: string | null;
  stock: number | null;
  delivery_count: number;
  created_at: string;
  updated_at: string;
};

type AssetRow = {
  id: number;
  product_id: number;
  storage_node_id: string | null;
  file_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  mtime_ms: number;
  created_at: string;
};

type DeliveryRow = {
  id: number;
  product_id: number;
  kind: MarketDeliveryKind;
  title: string;
  content: string;
  market_asset_id: number | null;
  sort_order: number;
  asset_id: number | null;
  asset_product_id: number | null;
  storage_node_id: string | null;
  file_name: string | null;
  stored_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  mtime_ms: number | null;
  asset_created_at: string | null;
};

type OrderRow = {
  id: number;
  order_no: string;
  user_id: number;
  product_id: number | null;
  product_title: string;
  currency: UserCurrency;
  amount: number;
  status: MarketOrder["status"];
  created_at: string;
  fulfilled_at: string | null;
};

type OrderDeliveryRow = {
  id: number;
  order_id: number;
  kind: MarketDeliveryKind;
  title: string;
  content: string;
  market_asset_id: number | null;
  sort_order: number;
  asset_id: number | null;
  asset_product_id: number | null;
  storage_node_id: string | null;
  file_name: string | null;
  stored_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  mtime_ms: number | null;
  asset_created_at: string | null;
};

export class MarketError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid"
      | "not_found"
      | "unavailable"
      | "level_required"
      | "purchase_limit"
      | "out_of_stock"
      | "insufficient_balance"
      | "configuration",
  ) {
    super(message);
  }
}

function toProduct(row: ProductRow): MarketProduct {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    minLevel: row.min_level,
    priceCookie: row.price_cookie,
    priceSoda: row.price_soda,
    purchaseLimitPerUser: row.purchase_limit_per_user,
    sortOrder: row.sort_order,
    coverKey: row.cover_key,
    coverStorageNodeId: row.cover_storage_node_id,
    stock: row.stock,
    deliveryCount: row.delivery_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAsset(row: AssetRow): MarketAsset {
  return {
    id: row.id,
    productId: row.product_id,
    storageNodeId: row.storage_node_id,
    fileName: row.file_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    createdAt: row.created_at,
  };
}

function deliveryAsset(row: DeliveryRow | OrderDeliveryRow): MarketAsset | null {
  if (
    !row.asset_id ||
    !row.asset_product_id ||
    !row.file_name ||
    !row.stored_name ||
    !row.mime_type ||
    !row.size_bytes ||
    !row.mtime_ms ||
    !row.asset_created_at
  ) {
    return null;
  }
  return toAsset({
    id: row.asset_id,
    product_id: row.asset_product_id,
    storage_node_id: row.storage_node_id,
    file_name: row.file_name,
    stored_name: row.stored_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    mtime_ms: row.mtime_ms,
    created_at: row.asset_created_at,
  });
}

function productSelect(): string {
  return `
    SELECT p.id, p.slug, p.title, p.description, p.status, p.min_level,
           p.price_cookie, p.price_soda, p.purchase_limit_per_user, p.sort_order,
           p.cover_key, p.cover_storage_node_id,
           CASE
             WHEN EXISTS(
               SELECT 1 FROM market_delivery_items d
               WHERE d.product_id = p.id AND d.kind = 'secret'
             )
             THEN (
               SELECT COUNT(*) FROM market_secret_inventory s
               WHERE s.product_id = p.id AND s.status = 'available'
             )
             ELSE NULL
           END AS stock,
           (SELECT COUNT(*) FROM market_delivery_items d WHERE d.product_id = p.id) AS delivery_count,
           p.created_at, p.updated_at
    FROM market_products p`;
}

function cleanText(value: string, max: number): string {
  return value.normalize("NFKC").trim().slice(0, max);
}

export function normalizeMarketSlug(value: string): string | null {
  const slug = value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "-");
  return /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug) ? slug : null;
}

function generatedMarketSlug(title: string): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  const base = ascii.length >= 3 ? ascii : ascii ? `item-${ascii}` : "";
  return normalizeMarketSlug(base) || `item-${crypto.randomBytes(5).toString("hex")}`;
}

function uniqueMarketSlug(value: string, title: string, excludeId = 0): string {
  const explicit = value.trim();
  const base = explicit ? normalizeMarketSlug(explicit) : generatedMarketSlug(title);
  if (!base) throw new MarketError("链接标识格式无效", "invalid");
  const exists = getDb().prepare(
    `SELECT 1 AS found
     FROM market_products
     WHERE slug = ? COLLATE NOCASE AND id != ?
     LIMIT 1`,
  );
  if (!exists.get(base, excludeId)) return base;
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const candidate = `${base.slice(0, 79 - String(suffix).length)}-${suffix}`;
    if (!exists.get(candidate, excludeId)) return candidate;
  }
  throw new MarketError("无法生成可用的商品链接", "invalid");
}

export function marketProductCoverUrl(
  product: Pick<MarketProduct, "id" | "coverKey">,
): string | null {
  return product.coverKey
    ? `/market/cover/${product.id}?v=${encodeURIComponent(product.coverKey)}`
    : null;
}

function marketSecret(): Buffer {
  const value =
    process.env.MARKET_SECRET_KEY ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.MEDIA_SIGNING_SECRET ||
    "";
  if (value.length < 32) {
    throw new MarketError("请先配置 MARKET_SECRET_KEY", "configuration");
  }
  return crypto.createHash("sha256").update(value).digest();
}

function encryptSecret(value: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", marketSecret(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

function decryptSecret(ciphertext: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", marketSecret(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptedDeliveryValue(value: string): string {
  const encrypted = encryptSecret(value);
  return `enc:v1:${encrypted.iv}:${encrypted.authTag}:${encrypted.ciphertext}`;
}

export function revealOrderDeliveryContent(delivery: Pick<MarketOrderDelivery, "kind" | "content">): string {
  if (delivery.kind !== "secret" || !delivery.content.startsWith("enc:v1:")) {
    return delivery.content;
  }
  const [, version, iv, authTag, ciphertext] = delivery.content.split(":");
  if (version !== "v1" || !iv || !authTag || !ciphertext) {
    return "";
  }
  try {
    return decryptSecret(ciphertext, iv, authTag);
  } catch {
    return "";
  }
}

function codeHash(value: string): string {
  return crypto.createHmac("sha256", marketSecret()).update(value).digest("hex");
}

function normalizeCode(value: string): string {
  return value.trim().toLocaleUpperCase("en-US").replace(/\s+/g, "");
}

function randomCode(prefix: string): string {
  const raw = crypto.randomBytes(15).toString("base64url").toLocaleUpperCase("en-US").replace(/[-_]/g, "X");
  return `${prefix}-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

export function listMarketProducts(options: { includeUnpublished?: boolean } = {}): MarketProduct[] {
  const rows = getDb()
    .prepare(
      `${productSelect()}
       WHERE p.deleted_at IS NULL
       ${options.includeUnpublished ? "" : "AND p.status = 'published'"}
       ORDER BY p.sort_order ASC, p.updated_at DESC, p.id DESC`,
    )
    .all() as ProductRow[];
  return rows.map(toProduct);
}

export function getMarketProductById(id: number): MarketProduct | null {
  const row = getDb()
    .prepare(`${productSelect()} WHERE p.id = ? AND p.deleted_at IS NULL`)
    .get(id) as ProductRow | undefined;
  return row ? toProduct(row) : null;
}

export function getMarketProductBySlug(slug: string): MarketProduct | null {
  const row = getDb()
    .prepare(`${productSelect()} WHERE p.slug = ? COLLATE NOCASE AND p.deleted_at IS NULL`)
    .get(slug) as ProductRow | undefined;
  return row ? toProduct(row) : null;
}

export function createMarketProduct(input: {
  slug: string;
  title: string;
  description?: string;
  minLevel?: number;
  priceCookie?: number | null;
  priceSoda?: number | null;
  purchaseLimitPerUser?: number;
  sortOrder?: number;
}): number {
  const title = cleanText(input.title, 120);
  if (!title) throw new MarketError("请输入商品名称", "invalid");
  if (input.priceCookie != null && input.priceSoda != null) {
    throw new MarketError("商品只能选择一种支付方式", "invalid");
  }
  const slug = uniqueMarketSlug(input.slug, title);
  const info = getDb()
    .prepare(
      `INSERT INTO market_products (
         slug, title, description, min_level, price_cookie, price_soda,
         purchase_limit_per_user, sort_order
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug,
      title,
      (input.description || "").trim().slice(0, 20_000),
      Math.min(Math.max(Math.floor(input.minLevel || 1), 1), 6),
      input.priceCookie == null ? null : Math.max(Math.floor(input.priceCookie), 0),
      input.priceSoda == null ? null : Math.max(Math.floor(input.priceSoda), 0),
      Math.min(Math.max(Math.floor(input.purchaseLimitPerUser ?? 1), 0), 10_000),
      Math.min(Math.max(Math.floor(input.sortOrder || 0), -1_000_000), 1_000_000),
    );
  return Number(info.lastInsertRowid);
}

export function updateMarketProduct(input: {
  id: number;
  slug: string;
  title: string;
  description?: string;
  status: MarketProductStatus;
  minLevel: number;
  priceCookie: number | null;
  priceSoda: number | null;
  purchaseLimitPerUser: number;
  sortOrder: number;
}): boolean {
  const title = cleanText(input.title, 120);
  if (!title || !["draft", "published", "archived"].includes(input.status)) {
    throw new MarketError("商品参数无效", "invalid");
  }
  const priceCount = Number(input.priceCookie != null) + Number(input.priceSoda != null);
  if (priceCount > 1 || (input.status === "published" && priceCount !== 1)) {
    throw new MarketError("商品只能选择一种支付方式", "invalid");
  }
  const slug = uniqueMarketSlug(input.slug, title, input.id);
  return getDb()
    .prepare(
      `UPDATE market_products
       SET slug = ?, title = ?, description = ?, status = ?, min_level = ?,
           price_cookie = ?, price_soda = ?, purchase_limit_per_user = ?, sort_order = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      slug,
      title,
      (input.description || "").trim().slice(0, 20_000),
      input.status,
      Math.min(Math.max(Math.floor(input.minLevel || 1), 1), 6),
      input.priceCookie == null ? null : Math.max(Math.floor(input.priceCookie), 0),
      input.priceSoda == null ? null : Math.max(Math.floor(input.priceSoda), 0),
      Math.min(Math.max(Math.floor(input.purchaseLimitPerUser), 0), 10_000),
      Math.min(Math.max(Math.floor(input.sortOrder), -1_000_000), 1_000_000),
      input.id,
    ).changes > 0;
}

export function setMarketProductStatus(id: number, status: "published" | "archived"): boolean {
  return getDb()
    .prepare(
      `UPDATE market_products
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(status, id).changes > 0;
}

export function replaceMarketProductCover(
  id: number,
  cover: { key: string; storageNodeId: string | null } | null,
): { key: string; storageNodeId: string | null } | undefined {
  if (cover && !/^[a-f0-9]{32}$/.test(cover.key)) {
    throw new MarketError("封面标识无效", "invalid");
  }
  const db = getDb();
  const current = db
    .prepare(
      `SELECT cover_key, cover_storage_node_id
       FROM market_products
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as { cover_key: string | null; cover_storage_node_id: string | null } | undefined;
  if (!current) return undefined;
  db.prepare(
    `UPDATE market_products
     SET cover_key = ?, cover_storage_node_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
  ).run(cover?.key || null, cover?.storageNodeId || null, id);
  return current.cover_key
    ? { key: current.cover_key, storageNodeId: current.cover_storage_node_id }
    : undefined;
}

export function deleteMarketProduct(id: number): boolean {
  return getDb()
    .prepare(
      `UPDATE market_products
       SET status = 'archived', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(id).changes > 0;
}

export function listMarketAssets(productId: number): MarketAsset[] {
  return (getDb()
    .prepare(
      `SELECT id, product_id, storage_node_id, file_name, stored_name, mime_type, size_bytes, mtime_ms, created_at
       FROM market_assets
       WHERE product_id = ?
       ORDER BY id DESC`,
    )
    .all(productId) as AssetRow[]).map(toAsset);
}

export function getMarketAssetById(id: number): MarketAsset | null {
  const row = getDb()
    .prepare(
      `SELECT id, product_id, storage_node_id, file_name, stored_name, mime_type, size_bytes, mtime_ms, created_at
       FROM market_assets
       WHERE id = ?`,
    )
    .get(id) as AssetRow | undefined;
  return row ? toAsset(row) : null;
}

export function userOwnsMarketAsset(userId: number, orderId: number, assetId: number): boolean {
  return Boolean(getDb()
    .prepare(
      `SELECT 1 AS found
       FROM market_orders o
       JOIN market_order_deliveries d ON d.order_id = o.id
       WHERE o.id = ? AND o.user_id = ? AND o.status = 'fulfilled'
         AND d.kind = 'file' AND d.market_asset_id = ?
       LIMIT 1`,
    )
    .get(orderId, userId, assetId));
}

function deliverySelect(table: "market_delivery_items" | "market_order_deliveries"): string {
  const productColumn = table === "market_delivery_items" ? "d.product_id" : "a.product_id";
  return `
    SELECT d.*, a.id AS asset_id, ${productColumn} AS asset_product_id,
           a.storage_node_id, a.file_name, a.stored_name, a.mime_type,
           a.size_bytes, a.mtime_ms, a.created_at AS asset_created_at
    FROM ${table} d
    LEFT JOIN market_assets a ON a.id = d.market_asset_id`;
}

export function listMarketDeliveryItems(productId: number): MarketDeliveryItem[] {
  const rows = getDb()
    .prepare(
      `${deliverySelect("market_delivery_items")}
       WHERE d.product_id = ?
       ORDER BY d.sort_order ASC, d.id ASC`,
    )
    .all(productId) as DeliveryRow[];
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    marketAssetId: row.market_asset_id,
    sortOrder: row.sort_order,
    asset: deliveryAsset(row),
  }));
}

export function saveMarketDeliveryItem(input: {
  id?: number;
  productId: number;
  kind: MarketDeliveryKind;
  title?: string;
  content?: string;
  marketAssetId?: number | null;
  sortOrder?: number;
}): number {
  if (!["text", "secret", "file", "entitlement"].includes(input.kind)) {
    throw new MarketError("交付类型无效", "invalid");
  }
  if (input.kind === "secret") {
    const existing = getDb()
      .prepare(
        `SELECT id FROM market_delivery_items
         WHERE product_id = ? AND kind = 'secret' AND id <> ?
         LIMIT 1`,
      )
      .get(input.productId, input.id || 0);
    if (existing) {
      throw new MarketError("每个商品只能配置一项卡密交付", "invalid");
    }
  }
  const title = cleanText(input.title || "", 100);
  const content = (input.content || "").trim().slice(0, 100_000);
  const assetId = input.kind === "file" && input.marketAssetId ? input.marketAssetId : null;
  if (input.kind === "file" && !assetId) {
    throw new MarketError("请选择需要交付的文件", "invalid");
  }
  if (input.id) {
    const changed = getDb()
      .prepare(
        `UPDATE market_delivery_items
         SET kind = ?, title = ?, content = ?, market_asset_id = ?, sort_order = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND product_id = ?`,
      )
      .run(
        input.kind,
        title,
        content,
        assetId,
        Math.floor(input.sortOrder || 0),
        input.id,
        input.productId,
      ).changes;
    if (!changed) throw new MarketError("交付项不存在", "not_found");
    return input.id;
  }
  const info = getDb()
    .prepare(
      `INSERT INTO market_delivery_items (
         product_id, kind, title, content, market_asset_id, sort_order
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.productId, input.kind, title, content, assetId, Math.floor(input.sortOrder || 0));
  return Number(info.lastInsertRowid);
}

export function deleteMarketDeliveryItem(productId: number, id: number): boolean {
  return getDb()
    .prepare("DELETE FROM market_delivery_items WHERE id = ? AND product_id = ?")
    .run(id, productId).changes > 0;
}

export function importMarketSecrets(productId: number, values: string[]): number {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 10_000);
  if (!unique.length) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO market_secret_inventory (product_id, ciphertext, iv, auth_tag)
     VALUES (?, ?, ?, ?)`,
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const value of unique) {
      const encrypted = encryptSecret(value.slice(0, 4_000));
      insert.run(productId, encrypted.ciphertext, encrypted.iv, encrypted.authTag);
    }
    db.exec("COMMIT");
    return unique.length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function orderFromRow(row: OrderRow): MarketOrder {
  return {
    id: row.id,
    orderNo: row.order_no,
    userId: row.user_id,
    productId: row.product_id,
    productTitle: row.product_title,
    currency: row.currency,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
    fulfilledAt: row.fulfilled_at,
  };
}

export function listUserMarketOrders(userId: number, limit = 100): MarketOrder[] {
  return (getDb()
    .prepare(
      `SELECT id, order_no, user_id, product_id, product_title, currency, amount, status, created_at, fulfilled_at
       FROM market_orders
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, Math.min(Math.max(Math.floor(limit), 1), 200)) as OrderRow[]).map(orderFromRow);
}

export function listAdminMarketOrders(limit = 100): MarketOrder[] {
  return (getDb()
    .prepare(
      `SELECT id, order_no, user_id, product_id, product_title, currency, amount, status, created_at, fulfilled_at
       FROM market_orders
       WHERE admin_deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(Math.floor(limit), 1), 500)) as OrderRow[]).map(orderFromRow);
}

export function removeAdminMarketOrder(id: number): boolean {
  return getDb()
    .prepare(
      `UPDATE market_orders
       SET admin_deleted_at = CURRENT_TIMESTAMP
       WHERE id = ? AND admin_deleted_at IS NULL`,
    )
    .run(id).changes > 0;
}

export function getUserMarketOrder(userId: number, orderNo: string): MarketOrder | null {
  const row = getDb()
    .prepare(
      `SELECT id, order_no, user_id, product_id, product_title, currency, amount, status, created_at, fulfilled_at
       FROM market_orders
       WHERE user_id = ? AND order_no = ?`,
    )
    .get(userId, orderNo) as OrderRow | undefined;
  return row ? orderFromRow(row) : null;
}

export function listMarketOrderDeliveries(orderId: number): MarketOrderDelivery[] {
  const rows = getDb()
    .prepare(
      `${deliverySelect("market_order_deliveries")}
       WHERE d.order_id = ?
       ORDER BY d.sort_order ASC, d.id ASC`,
    )
    .all(orderId) as OrderDeliveryRow[];
  return rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    marketAssetId: row.market_asset_id,
    sortOrder: row.sort_order,
    asset: deliveryAsset(row),
  }));
}

function purchasePrice(product: ProductRow, currency: UserCurrency): number | null {
  return currency === "cookie" ? product.price_cookie : product.price_soda;
}

function createOrderInTransaction(input: {
  userId: number;
  product: ProductRow;
  currency: UserCurrency;
  amount: number;
  charge: boolean;
  referenceKey: string;
}): MarketOrder {
  const db = getDb();
  const deliveries = db
    .prepare(
      `SELECT id, product_id, kind, title, content, market_asset_id, sort_order
       FROM market_delivery_items
       WHERE product_id = ?
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(input.product.id) as Array<{
    id: number;
    product_id: number;
    kind: MarketDeliveryKind;
    title: string;
    content: string;
    market_asset_id: number | null;
    sort_order: number;
  }>;
  if (!deliveries.length) {
    throw new MarketError("商品尚未配置交付内容", "unavailable");
  }

  let balance = 0;
  if (input.charge && input.amount > 0) {
    const column = input.currency === "cookie" ? "cookie_balance" : "soda_balance";
    const balanceRow = db
      .prepare(`SELECT ${column} AS balance FROM users WHERE id = ?`)
      .get(input.userId) as { balance: number };
    balance = Math.floor(balanceRow.balance || 0);
    if (balance < input.amount) {
      throw new MarketError(input.currency === "cookie" ? "曲奇不足" : "苏打不足", "insufficient_balance");
    }
    balance -= input.amount;
    db.prepare(`UPDATE users SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(balance, input.userId);
  }

  const orderNo = `M${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  const orderInfo = db
    .prepare(
      `INSERT INTO market_orders (
         order_no, user_id, product_id, product_title, currency, amount, status
       )
       VALUES (?, ?, ?, ?, ?, ?, 'paid')`,
    )
    .run(orderNo, input.userId, input.product.id, input.product.title, input.currency, input.amount);
  const orderId = Number(orderInfo.lastInsertRowid);

  if (input.charge && input.amount > 0) {
    db.prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       )
       VALUES (?, ?, ?, ?, 'market_purchase', ?, ?)`,
    ).run(
      input.userId,
      input.currency,
      -input.amount,
      balance,
      input.referenceKey || `market-order:${orderNo}`,
      `购买「${input.product.title.slice(0, 100)}」`,
    );
  }

  const insertDelivery = db.prepare(
    `INSERT INTO market_order_deliveries (
       order_id, kind, title, content, market_asset_id, sort_order
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const delivery of deliveries) {
    let content = delivery.content;
    if (delivery.kind === "secret") {
      const secret = db
        .prepare(
          `SELECT id, ciphertext, iv, auth_tag
           FROM market_secret_inventory
           WHERE product_id = ? AND status = 'available'
           ORDER BY id ASC
           LIMIT 1`,
        )
        .get(input.product.id) as {
        id: number;
        ciphertext: string;
        iv: string;
        auth_tag: string;
      } | undefined;
      if (!secret) {
        throw new MarketError("卡密库存不足", "out_of_stock");
      }
      content = encryptedDeliveryValue(decryptSecret(secret.ciphertext, secret.iv, secret.auth_tag));
      db.prepare(
        `UPDATE market_secret_inventory
         SET status = 'delivered', order_id = ?, delivered_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'available'`,
      ).run(orderId, secret.id);
    }
    insertDelivery.run(
      orderId,
      delivery.kind,
      delivery.title,
      content,
      delivery.market_asset_id,
      delivery.sort_order,
    );
    if (delivery.kind === "entitlement") {
      const entitlement = decodeEntitlementDefinition(delivery.content);
      if (!entitlement) {
        throw new MarketError("商品权益配置无效", "configuration");
      }
      grantUserEntitlement({
        userId: input.userId,
        definition: entitlement,
        sourceOrderId: orderId,
        db,
      });
    }
  }
  db.prepare(
    `UPDATE market_orders
     SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(orderId);
  const row = db
    .prepare(
      `SELECT id, order_no, user_id, product_id, product_title, currency, amount,
              status, created_at, fulfilled_at
       FROM market_orders WHERE id = ?`,
    )
    .get(orderId) as OrderRow;
  return orderFromRow(row);
}

export function purchaseMarketProduct(input: {
  userId: number;
  productId: number;
  currency: UserCurrency;
}): MarketOrder {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const user = db
      .prepare("SELECT status, trust_level FROM users WHERE id = ?")
      .get(input.userId) as { status: string; trust_level: number } | undefined;
    const product = db
      .prepare(`${productSelect()} WHERE p.id = ? AND p.deleted_at IS NULL`)
      .get(input.productId) as ProductRow | undefined;
    if (!user || user.status !== "active" || !product) {
      throw new MarketError("商品不存在", "not_found");
    }
    if (product.status !== "published") {
      throw new MarketError("商品暂不可购买", "unavailable");
    }
    if (user.trust_level < product.min_level) {
      throw new MarketError(`达到 Lv.${product.min_level} 后可购买`, "level_required");
    }
    const price = purchasePrice(product, input.currency);
    if (price == null) {
      throw new MarketError("该商品不支持此支付方式", "invalid");
    }
    if (product.purchase_limit_per_user > 0) {
      const purchased = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM market_orders
           WHERE user_id = ? AND product_id = ? AND status = 'fulfilled'`,
        )
        .get(input.userId, product.id) as { count: number };
      if (purchased.count >= product.purchase_limit_per_user) {
        throw new MarketError("已达到该商品的购买次数上限", "purchase_limit");
      }
    }
    const order = createOrderInTransaction({
      userId: input.userId,
      product,
      currency: input.currency,
      amount: price,
      charge: true,
      referenceKey: "",
    });
    db.exec("COMMIT");
    return order;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createRedemptionCodeBatch(input: {
  name: string;
  rewardType: "cookie" | "soda" | "product";
  rewardAmount?: number;
  productId?: number | null;
  count: number;
  expiresAt?: string | null;
}): { batchId: number; codes: string[] } {
  const count = Math.min(Math.max(Math.floor(input.count), 1), 5_000);
  if (input.rewardType === "product" && !input.productId) {
    throw new MarketError("请选择兑换商品", "invalid");
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const batchInfo = db
      .prepare(
        `INSERT INTO redemption_code_batches (
           name, reward_type, reward_amount, product_id, expires_at
         )
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        cleanText(input.name, 100) || "兑换码",
        input.rewardType,
        input.rewardType === "product" ? 0 : Math.max(Math.floor(input.rewardAmount || 0), 1),
        input.rewardType === "product" ? input.productId ?? null : null,
        input.expiresAt || null,
      );
    const batchId = Number(batchInfo.lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO redemption_codes (batch_id, code_hash, code_hint)
       VALUES (?, ?, ?)`,
    );
    const prefix = input.rewardType === "cookie" ? "CK" : input.rewardType === "soda" ? "SD" : "PR";
    const codes: string[] = [];
    while (codes.length < count) {
      const code = randomCode(prefix);
      try {
        insert.run(batchId, codeHash(code), code.slice(-6));
        codes.push(code);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
      }
    }
    db.exec("COMMIT");
    return { batchId, codes };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function redeemMarketCode(
  userId: number,
  codeValue: string,
): { rewardType: "cookie" | "soda" | "product"; amount: number; orderNo?: string } {
  const normalized = normalizeCode(codeValue);
  if (normalized.length < 10) {
    throw new MarketError("兑换码无效", "invalid");
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT c.id, c.status, b.id AS batch_id, b.status AS batch_status,
                b.reward_type, b.reward_amount, b.product_id, b.expires_at
         FROM redemption_codes c
         JOIN redemption_code_batches b ON b.id = c.batch_id
         WHERE c.code_hash = ?`,
      )
      .get(codeHash(normalized)) as {
      id: number;
      status: string;
      batch_id: number;
      batch_status: string;
      reward_type: "cookie" | "soda" | "product";
      reward_amount: number;
      product_id: number | null;
      expires_at: string | null;
    } | undefined;
    if (
      !row ||
      row.status !== "available" ||
      row.batch_status !== "active" ||
      (row.expires_at && Date.parse(row.expires_at) <= Date.now())
    ) {
      throw new MarketError("兑换码无效或已使用", "unavailable");
    }
    const user = db
      .prepare("SELECT status, soda_balance, cookie_balance FROM users WHERE id = ?")
      .get(userId) as { status: string; soda_balance: number; cookie_balance: number } | undefined;
    if (!user || user.status !== "active") {
      throw new MarketError("用户不可用", "invalid");
    }

    let orderNo: string | undefined;
    if (row.reward_type === "product") {
      const product = db
        .prepare(`${productSelect()} WHERE p.id = ? AND p.deleted_at IS NULL`)
        .get(row.product_id) as ProductRow | undefined;
      if (!product) throw new MarketError("兑换商品已下架", "unavailable");
      orderNo = createOrderInTransaction({
        userId,
        product,
        currency: "cookie",
        amount: 0,
        charge: false,
        referenceKey: `redemption-code:${row.id}`,
      }).orderNo;
    } else {
      const column = row.reward_type === "cookie" ? "cookie_balance" : "soda_balance";
      const current = row.reward_type === "cookie" ? user.cookie_balance : user.soda_balance;
      const balance = current + row.reward_amount;
      db.prepare(`UPDATE users SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(balance, userId);
      db.prepare(
        `INSERT INTO user_currency_transactions (
           user_id, currency, amount, balance_after, source, reference_key, note
         )
         VALUES (?, ?, ?, ?, 'redemption_code', ?, '兑换码充值')`,
      ).run(userId, row.reward_type, row.reward_amount, balance, `redemption-code:${row.id}`);
    }
    db.prepare(
      `UPDATE redemption_codes
       SET status = 'redeemed', redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'available'`,
    ).run(userId, row.id);
    db.exec("COMMIT");
    return { rewardType: row.reward_type, amount: row.reward_amount, orderNo };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listRedemptionCodeBatches(limit = 100): Array<{
  id: number;
  name: string;
  rewardType: "cookie" | "soda" | "product";
  rewardAmount: number;
  productId: number | null;
  status: "active" | "disabled";
  expiresAt: string | null;
  totalCodes: number;
  redeemedCodes: number;
  createdAt: string;
}> {
  return (getDb()
    .prepare(
      `SELECT b.id, b.name, b.reward_type, b.reward_amount, b.product_id, b.status,
              b.expires_at, b.created_at,
              COUNT(c.id) AS total_codes,
              SUM(CASE WHEN c.status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed_codes
       FROM redemption_code_batches b
       LEFT JOIN redemption_codes c ON c.batch_id = b.id
       GROUP BY b.id
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(Math.floor(limit), 1), 500)) as Array<{
    id: number;
    name: string;
    reward_type: "cookie" | "soda" | "product";
    reward_amount: number;
    product_id: number | null;
    status: "active" | "disabled";
    expires_at: string | null;
    total_codes: number;
    redeemed_codes: number;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    name: row.name,
    rewardType: row.reward_type,
    rewardAmount: row.reward_amount,
    productId: row.product_id,
    status: row.status,
    expiresAt: row.expires_at,
    totalCodes: row.total_codes,
    redeemedCodes: row.redeemed_codes || 0,
    createdAt: row.created_at,
  }));
}
