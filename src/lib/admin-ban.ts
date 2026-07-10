import { getAdminAllowedIps, getAdminBlockedIps } from "./config";
import { matchesIpRule } from "./admin-access";
import { readSiteSettings, writeSiteSettings } from "./site-settings";

export function persistBlockedIp(ip: string): boolean {
  if (!ip || ip === "unknown" || ip.includes(",") || ip.includes("\n")) {
    return false;
  }

  if (getAdminAllowedIps().some((rule) => matchesIpRule(ip, rule))) {
    return false;
  }

  const blockedIps = getAdminBlockedIps();
  if (blockedIps.some((rule) => matchesIpRule(ip, rule))) {
    return false;
  }

  const settings = readSiteSettings();
  try {
    writeSiteSettings({
      ...settings,
      adminBlockedIps: [...blockedIps, ip].join("\n"),
    });
    return true;
  } catch {
    return false;
  }
}
