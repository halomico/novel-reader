import crypto from "node:crypto";
import { getTrustedClientIp, type HeaderReader } from "@/core/security/client-ip";

export function engagementViewerKey(
  headers: HeaderReader,
  userId?: number | null,
): string {
  if (Number.isSafeInteger(userId) && Number(userId) > 0) return `user:${Number(userId)}`;
  const secret = process.env.ENGAGEMENT_HASH_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.MEDIA_SIGNING_SECRET || "";
  const ip = getTrustedClientIp(headers);
  const userAgent = (headers.get("user-agent") || "").slice(0, 300);
  const material = `${ip}\0${userAgent}`;
  if (secret.length >= 32) {
    return `guest:${crypto.createHmac("sha256", secret).update(material).digest("base64url").slice(0, 32)}`;
  }
  return `guest:${crypto.createHash("sha256").update(material).digest("base64url").slice(0, 32)}`;
}
