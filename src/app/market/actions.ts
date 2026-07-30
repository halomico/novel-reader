"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCookieToSodaRate, isMarketEnabled } from "@/lib/config";
import {
  MarketError,
  purchaseMarketProduct,
  redeemMarketCode,
} from "@/lib/market";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { exchangeCookieForSoda, type UserCurrency } from "@/lib/user-wallet";

function marketNotice(pathname: string, message: string, tone: "success" | "warning" | "error" = "success"): never {
  const params = new URLSearchParams({ notice: message, tone });
  redirect(`${pathname}?${params.toString()}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof MarketError) return error.message;
  if (
    error instanceof Error &&
    ["曲奇不足", "兑换数量过大", "苏打余额已达上限", "用户不可用"].includes(error.message)
  ) {
    return error.message;
  }
  console.error("Market purchase failed", error);
  return "操作失败，请稍后重试";
}

async function requireMarketUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Fmarket");
  if (!isMarketEnabled() || !hasUserPermission(user, "market_access")) {
    marketNotice("/", "集市暂不可用", "warning");
  }
  return user;
}

export async function purchaseMarketProductAction(formData: FormData) {
  const user = await requireMarketUser();
  const productId = Number(formData.get("productId"));
  const slug = String(formData.get("slug") || "");
  const returnPath = slug ? `/market/${encodeURIComponent(slug)}` : "/market";
  if (!hasUserPermission(user, "market_purchase")) {
    marketNotice(returnPath, "当前等级暂不能购买商品", "warning");
  }
  const currencyValue = String(formData.get("currency"));
  const currency: UserCurrency = currencyValue === "soda" ? "soda" : "cookie";
  let orderNo: string;
  try {
    const order = purchaseMarketProduct({ userId: user.id, productId, currency });
    orderNo = order.orderNo;
  } catch (error) {
    marketNotice(returnPath, errorMessage(error), "warning");
  }
  revalidatePath("/market");
  revalidatePath("/account");
  redirect(`/market/orders/${encodeURIComponent(orderNo)}?notice=${encodeURIComponent("购买成功")}&tone=success`);
}

export async function redeemMarketCodeAction(formData: FormData) {
  const user = await requireMarketUser();
  let result: ReturnType<typeof redeemMarketCode>;
  try {
    result = redeemMarketCode(user.id, String(formData.get("code") || ""));
  } catch (error) {
    marketNotice("/market", errorMessage(error), "warning");
  }
  revalidatePath("/market");
  revalidatePath("/account");
  if (result.orderNo) {
    redirect(`/market/orders/${encodeURIComponent(result.orderNo)}?notice=${encodeURIComponent("兑换成功")}&tone=success`);
  }
  const label = result.rewardType === "cookie" ? "曲奇" : "苏打";
  marketNotice("/market", `已到账 ${result.amount} ${label}`);
}

export async function exchangeCookieForSodaAction(formData: FormData) {
  const user = await requireMarketUser();
  try {
    const result = exchangeCookieForSoda({
      userId: user.id,
      cookieAmount: Number(formData.get("cookieAmount")),
      sodaPerCookie: getCookieToSodaRate(),
    });
    revalidatePath("/market");
    revalidatePath("/account");
    marketNotice("/market", `已兑换 ${result.sodaReceived} 苏打`);
  } catch (error) {
    marketNotice("/market", errorMessage(error), "warning");
  }
}
