"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isEmailVerificationConfigured, resendVerificationEmail } from "@/lib/email-verification";

function origin(headerStore: Awaited<ReturnType<typeof headers>>): string {
  const protocol = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = headerStore.get("x-forwarded-host")?.split(",")[0]?.trim() || headerStore.get("host");
  return host ? `${protocol}://${host}` : process.env.SITE_URL || "";
}

export async function resendVerificationEmailAction(formData: FormData) {
  if (!isEmailVerificationConfigured()) {
    redirect("/verify-email?notice=" + encodeURIComponent("邮件服务暂不可用") + "&tone=warning");
  }
  try {
    const headerStore = await headers();
    await resendVerificationEmail(String(formData.get("email") || ""), origin(headerStore));
  } catch (error) {
    console.error("Failed to resend verification email", error);
  }
  redirect(
    "/verify-email?notice=" +
      encodeURIComponent("如果账号需要验证，邮件会在稍后送达") +
      "&tone=success",
  );
}
