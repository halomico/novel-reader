"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCookieToSodaRate,
  isBidirectionalCurrencyExchangeEnabled,
  isMarketEnabled,
} from "@/lib/config";
import {
  MarketError,
  purchaseMarketProduct,
  redeemMarketCode,
} from "@/lib/market";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import {
  exchangeUserCurrency,
  type CurrencyExchangeDirection,
  type UserCurrency,
} from "@/lib/user-wallet";

function marketNotice(pathname: string, message: string, tone: "success" | "warning" | "error" = "success"): never {
  const params = new URLSearchParams({ notice: message, tone });
  redirect(`${pathname}?${params.toString()}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof MarketError) return error.message;
  if (
    error instanceof Error &&
    (
      [
        "请输入有效兑换数量",
        "曲奇不足",
        "苏打不足",
        "兑换数量过大",
        "曲奇余额已达上限",
        "苏打余额已达上限",
        "用户不可用",
      ].includes(error.message) || /^苏打数量须为 \d+ 的倍数$/u.test(error.message)
    )
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

export async function exchangeCurrencyAction(formData: FormData) {
  const user = await requireMarketUser();
  const direction: CurrencyExchangeDirection = formData.get("direction") === "soda-to-cookie"
    ? "soda-to-cookie"
    : "cookie-to-soda";
  if (direction === "soda-to-cookie" && !isBidirectionalCurrencyExchangeEnabled()) {
    marketNotice("/market", "暂未开放苏打换曲奇", "warning");
  }
  let result: ReturnType<typeof exchangeUserCurrency>;
  try {
    result = exchangeUserCurrency({
      userId: user.id,
      direction,
      sourceAmount: Number(formData.get("sourceAmount")),
      sodaPerCookie: getCookieToSodaRate(),
    });
  } catch (error) {
    marketNotice("/market", errorMessage(error), "warning");
  }
  revalidatePath("/market");
  revalidatePath("/account");
  marketNotice("/market", `已兑换 ${result.receivedAmount} ${direction === "cookie-to-soda" ? "苏打" : "曲奇"}`);
}
