"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { deleteStoredCover } from "@/lib/media-cover";
import {
  encodeEntitlementDefinition,
  entitlementTargetExists,
  parseEntitlementDefinition,
} from "@/lib/entitlements";
import {
  createMarketProduct,
  createRedemptionCodeBatch,
  deleteMarketDeliveryItem,
  deleteMarketProduct,
  getMarketProductById,
  importMarketSecrets,
  listMarketDeliveryItems,
  MarketError,
  removeAdminMarketOrder,
  saveMarketDeliveryItem,
  setMarketProductStatus,
  updateMarketProduct,
  type MarketDeliveryKind,
} from "@/lib/market";
import { mutationResult, type MutationResult } from "@/lib/mutation-result";

async function requireAdmin() {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed || !(await getAdminSession())) {
    redirect("/admin/login");
  }
}

function notice(pathname: string, message: string, tone: "success" | "warning" | "error" = "success"): never {
  const params = new URLSearchParams({ notice: message, tone });
  redirect(`${pathname}?${params.toString()}`);
}

function marketMessage(error: unknown): string {
  if (error instanceof MarketError) return error.message;
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed: market_products.slug")) {
    return "链接标识已被使用";
  }
  console.error("Market action failed", error);
  return "操作失败，请稍后重试";
}

function selectedPrice(formData: FormData): { priceCookie: number | null; priceSoda: number | null } {
  const currency = String(formData.get("currency") || "");
  if (currency !== "cookie" && currency !== "soda") {
    throw new MarketError("请选择支付方式", "invalid");
  }
  const price = Math.min(
    Math.max(Math.floor(Number(formData.get("price")) || 0), 0),
    2_000_000_000,
  );
  return {
    priceCookie: currency === "cookie" ? price : null,
    priceSoda: currency === "soda" ? price : null,
  };
}

export async function createMarketProductAction(formData: FormData) {
  await requireAdmin();
  let id: number;
  try {
    const price = selectedPrice(formData);
    id = createMarketProduct({
      slug: String(formData.get("slug") || ""),
      title: String(formData.get("title") || ""),
      description: String(formData.get("description") || ""),
      minLevel: Number(formData.get("minLevel")),
      ...price,
      purchaseLimitPerUser: Number(formData.get("purchaseLimitPerUser")),
    });
  } catch (error) {
    notice("/admin/market/new", marketMessage(error), "warning");
  }
  revalidatePath("/admin/market");
  redirect(`/admin/market/${id}?tab=delivery&setup=1`);
}

export async function updateMarketProductInlineAction(
  formData: FormData,
): Promise<MutationResult<{ product: NonNullable<ReturnType<typeof getMarketProductById>> }>> {
  await requireAdmin();
  const id = Number(formData.get("productId"));
  try {
    const current = getMarketProductById(id);
    if (!current) return mutationResult(false, "商品不存在", "warning");
    const publish = formData.get("intent") === "publish";
    if (publish && !current.deliveryCount) {
      return mutationResult(false, "请先配置至少一项交付内容", "warning");
    }
    const price = selectedPrice(formData);
    if (!updateMarketProduct({
      id,
      slug: String(formData.get("slug") || ""),
      title: String(formData.get("title") || ""),
      description: String(formData.get("description") || ""),
      status: publish ? "published" : current.status,
      minLevel: Number(formData.get("minLevel")),
      ...price,
      purchaseLimitPerUser: Number(formData.get("purchaseLimitPerUser")),
      sortOrder: Number(formData.get("sortOrder")),
    })) {
      return mutationResult(false, "商品不存在", "warning");
    }
    revalidatePath("/market");
    revalidatePath(`/market/${current.slug}`);
    revalidatePath("/admin/market");
    const product = getMarketProductById(id);
    if (product && product.slug !== current.slug) {
      revalidatePath(`/market/${product.slug}`);
    }
    return product
      ? mutationResult(true, publish ? "商品已发布" : "商品信息已保存", "success", { product })
      : mutationResult(false, "商品不存在", "warning");
  } catch (error) {
    return mutationResult(false, marketMessage(error), "warning");
  }
}

export async function setMarketProductStatusAction(
  idValue: number,
  status: "published" | "archived",
): Promise<MutationResult<{ status: "published" | "archived" }>> {
  await requireAdmin();
  const id = Math.floor(Number(idValue));
  const product = getMarketProductById(id);
  if (!product) return mutationResult(false, "商品不存在", "warning");
  if (status === "published") {
    if (!product.deliveryCount) {
      return mutationResult(false, "请先配置至少一项交付内容", "warning");
    }
    if (Number(product.priceCookie != null) + Number(product.priceSoda != null) !== 1) {
      return mutationResult(false, "商品只能选择一种支付方式", "warning");
    }
  }
  if (!setMarketProductStatus(id, status)) {
    return mutationResult(false, "商品不存在", "warning");
  }
  revalidatePath("/market");
  revalidatePath(`/market/${product.slug}`);
  return mutationResult(
    true,
    status === "published" ? "商品已上架" : "商品已下架",
    "success",
    { status },
  );
}

export async function deleteMarketProductAction(idValue: number): Promise<MutationResult> {
  await requireAdmin();
  const id = Math.floor(Number(idValue));
  const product = getMarketProductById(id);
  if (!product || !deleteMarketProduct(id)) {
    return mutationResult(false, "商品不存在", "warning");
  }
  if (product.coverKey) {
    await deleteStoredCover(product.coverStorageNodeId, product.coverKey).catch((error) => {
      console.warn(`[market] failed to remove cover for deleted product ${product.id}`, error);
    });
  }
  revalidatePath("/market");
  revalidatePath(`/market/${product.slug}`);
  revalidatePath("/admin/market");
  return mutationResult(true, "商品已删除", "success");
}

export async function removeAdminMarketOrderAction(idValue: number): Promise<MutationResult> {
  await requireAdmin();
  const removed = removeAdminMarketOrder(Math.floor(Number(idValue)));
  return removed
    ? mutationResult(true, "订单已从后台列表移除", "success")
    : mutationResult(false, "订单不存在", "warning");
}

export async function saveMarketDeliveryItemInlineAction(
  formData: FormData,
): Promise<MutationResult<{ deliveries: ReturnType<typeof listMarketDeliveryItems> }>> {
  await requireAdmin();
  const productId = Number(formData.get("productId"));
  try {
    const kindValue = String(formData.get("kind"));
    const kind: MarketDeliveryKind =
      kindValue === "secret" || kindValue === "file" || kindValue === "entitlement" ? kindValue : "text";
    let content = String(formData.get("content") || "");
    if (kind === "entitlement") {
      const durationDays = Math.min(Math.max(Math.floor(Number(formData.get("durationDays")) || 0), 0), 3650);
      const definition = parseEntitlementDefinition({
        targetType: String(formData.get("targetType") || ""),
        targetId: String(formData.get("targetId") || ""),
        rights: formData.getAll("rights").map(String),
        durationSeconds: durationDays > 0 ? durationDays * 24 * 60 * 60 : null,
      });
      if (!definition || !entitlementTargetExists(definition)) {
        throw new MarketError("请选择有效的站内资源与权限", "invalid");
      }
      content = encodeEntitlementDefinition(definition);
    }
    saveMarketDeliveryItem({
      id: Number(formData.get("deliveryId")) || undefined,
      productId,
      kind,
      title: String(formData.get("title") || ""),
      content,
      marketAssetId: Number(formData.get("marketAssetId")) || null,
      sortOrder: Number(formData.get("sortOrder")),
    });
    revalidatePath("/market");
    return mutationResult(true, "交付内容已保存", "success", {
      deliveries: listMarketDeliveryItems(productId),
    });
  } catch (error) {
    return mutationResult(false, marketMessage(error), "warning");
  }
}

export async function deleteMarketDeliveryItemInlineAction(
  productIdValue: number,
  deliveryIdValue: number,
): Promise<MutationResult<{ deliveries: ReturnType<typeof listMarketDeliveryItems> }>> {
  await requireAdmin();
  const productId = Math.floor(Number(productIdValue));
  const deleted = deleteMarketDeliveryItem(productId, Math.floor(Number(deliveryIdValue)));
  if (!deleted) return mutationResult(false, "交付项不存在", "warning");
  revalidatePath("/market");
  return mutationResult(true, "交付项已删除", "success", {
    deliveries: listMarketDeliveryItems(productId),
  });
}

export async function importMarketSecretsInlineAction(
  productIdValue: number,
  secretsValue: string,
): Promise<MutationResult<{ imported: number }>> {
  await requireAdmin();
  const productId = Math.floor(Number(productIdValue));
  try {
    const count = importMarketSecrets(
      productId,
      String(secretsValue || "").split(/\r?\n/),
    );
    return mutationResult(
      count > 0,
      count ? `已导入 ${count} 条卡密` : "没有可导入的卡密",
      count ? "success" : "warning",
      { imported: count },
    );
  } catch (error) {
    return mutationResult(false, marketMessage(error), "warning");
  }
}

export async function createRedemptionCodeBatchAction(input: {
  name: string;
  rewardType: "cookie" | "soda" | "product";
  rewardAmount: number;
  productId: number | null;
  count: number;
  expiresAt: string;
}): Promise<{ ok: true; codes: string[] } | { ok: false; message: string }> {
  await requireAdmin();
  try {
    const result = createRedemptionCodeBatch({
      ...input,
      expiresAt: input.expiresAt || null,
    });
    revalidatePath("/admin/market");
    return { ok: true, codes: result.codes };
  } catch (error) {
    return { ok: false, message: marketMessage(error) };
  }
}
