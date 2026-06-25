import { readSiteSettings, type AdminLoginRecord, writeSiteSettings } from "./site-settings";

const MAX_ADMIN_LOGIN_RECORDS = 30;

function toPlainRecord(record: AdminLoginRecord): AdminLoginRecord {
  return {
    username: record.username,
    ip: record.ip,
    userAgent: record.userAgent,
    loggedAt: record.loggedAt,
  };
}

export function recordAdminLogin(username: string, ip: string, userAgent: string) {
  const settings = readSiteSettings();
  const nextRecord: AdminLoginRecord = {
    username,
    ip,
    userAgent: userAgent.slice(0, 180),
    loggedAt: new Date().toISOString(),
  };

  writeSiteSettings({
    ...settings,
    adminLoginRecords: [nextRecord, ...settings.adminLoginRecords.map(toPlainRecord)].slice(0, MAX_ADMIN_LOGIN_RECORDS),
  });
}

export function listAdminLoginRecords(): AdminLoginRecord[] {
  return readSiteSettings().adminLoginRecords.map(toPlainRecord);
}
