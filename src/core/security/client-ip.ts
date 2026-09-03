import crypto from "node:crypto";
import { isIP } from "node:net";

export type HeaderReader = { get(name: string): string | null };
export type TrustProxyMode = "none" | "signed" | "cloudflare";

export type TrustedClientAddress = {
  ip: string;
  country: string;
  trusted: boolean;
  mode: TrustProxyMode;
};

function trustProxyMode(env: NodeJS.ProcessEnv = process.env): TrustProxyMode {
  const value = String(env.TRUST_PROXY_MODE || "none").trim().toLowerCase();
  return value === "signed" || value === "cloudflare" ? value : "none";
}

export function normalizeIpLiteral(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes(",") || /[\r\n\0]/u.test(trimmed)) return "unknown";
  const bracketedIpv6 = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6 && isIP(bracketedIpv6[1])) return bracketedIpv6[1];
  if (isIP(trimmed)) return trimmed;
  const ipv4WithPort = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort && isIP(ipv4WithPort[1]) === 4 ? ipv4WithPort[1] : "unknown";
}

function normalizeCountry(value: string | null): string {
  const country = String(value || "").trim().toUpperCase();
  return /^(?:[A-Z]{2}|T1)$/u.test(country) ? country : "unknown";
}

function timingSafeSecretEqual(provided: string | null, expected: string): boolean {
  if (!provided || expected.length < 32) return false;
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function signedAddress(headers: HeaderReader, env: NodeJS.ProcessEnv): TrustedClientAddress {
  const secret = String(env.TRUST_PROXY_SECRET || "");
  const secretHeader = String(env.TRUST_PROXY_SECRET_HEADER || "x-novel-proxy-secret").trim().toLowerCase();
  if (!timingSafeSecretEqual(headers.get(secretHeader), secret)) {
    return { ip: "unknown", country: "unknown", trusted: false, mode: "signed" };
  }
  const ipHeader = String(env.TRUST_PROXY_IP_HEADER || "x-novel-client-ip").trim().toLowerCase();
  const countryHeader = String(env.TRUST_PROXY_COUNTRY_HEADER || "x-novel-country").trim().toLowerCase();
  const ip = normalizeIpLiteral(headers.get(ipHeader) || "");
  return {
    ip,
    country: normalizeCountry(headers.get(countryHeader)),
    trusted: ip !== "unknown",
    mode: "signed",
  };
}

function cloudflareAddress(headers: HeaderReader): TrustedClientAddress {
  const ip = normalizeIpLiteral(headers.get("cf-connecting-ip") || "");
  return {
    ip,
    country: normalizeCountry(headers.get("cf-ipcountry")),
    trusted: ip !== "unknown",
    mode: "cloudflare",
  };
}

/**
 * Resolves security-sensitive client identity only through an explicitly enabled
 * proxy boundary. In `none` mode user-controlled forwarding headers are ignored.
 */
export function getTrustedClientAddress(
  headers: HeaderReader,
  env: NodeJS.ProcessEnv = process.env,
): TrustedClientAddress {
  const mode = trustProxyMode(env);
  if (mode === "signed") return signedAddress(headers, env);
  if (mode === "cloudflare") return cloudflareAddress(headers);
  return { ip: "unknown", country: "unknown", trusted: false, mode: "none" };
}

export function getTrustedClientIp(headers: HeaderReader, env: NodeJS.ProcessEnv = process.env): string {
  return getTrustedClientAddress(headers, env).ip;
}

export function getTrustedRequestCountry(headers: HeaderReader, env: NodeJS.ProcessEnv = process.env): string {
  return getTrustedClientAddress(headers, env).country;
}

export function validateTrustedProxyConfiguration(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];
  const mode = trustProxyMode(env);
  if (mode === "signed" && String(env.TRUST_PROXY_SECRET || "").length < 32) {
    errors.push("TRUST_PROXY_MODE=signed requires TRUST_PROXY_SECRET with at least 32 characters");
  }
  if (mode === "cloudflare" && env.NODE_ENV === "production" && env.ALLOW_PUBLIC_ORIGIN === "1") {
    errors.push("Cloudflare proxy mode requires the application origin to be firewalled from direct public access");
  }
  return errors;
}
