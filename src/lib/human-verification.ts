export type HumanVerificationPurpose = "login" | "register";

type TurnstileResponse = {
  success?: boolean;
  action?: string;
  "error-codes"?: string[];
};

const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 8_000;

export function getHumanVerificationProvider(): "off" | "turnstile" {
  return process.env.HUMAN_VERIFICATION_PROVIDER?.trim().toLowerCase() === "turnstile" ? "turnstile" : "off";
}

export function getTurnstileSiteKey(): string | null {
  if (getHumanVerificationProvider() !== "turnstile") {
    return null;
  }
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
}

export async function verifyHumanRequest(
  formData: FormData,
  purpose: HumanVerificationPurpose,
  remoteIp: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (getHumanVerificationProvider() === "off") {
    return { ok: true };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = getTurnstileSiteKey();
  if (!secret || !siteKey) {
    return { ok: false, message: "人机验证尚未完成配置" };
  }
  const token = String(formData.get("cf-turnstile-response") || "").trim();
  if (!token) {
    return { ok: false, message: "请先完成人机验证" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, message: "人机验证服务暂时不可用" };
    }
    const result = (await response.json()) as TurnstileResponse;
    if (!result.success || result.action !== purpose) {
      return { ok: false, message: "人机验证失败或已过期，请重试" };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "人机验证服务暂时不可用" };
  } finally {
    clearTimeout(timeout);
  }
}
