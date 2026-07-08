import { getDb } from "./db";
import { readSiteSettings, type AdminLoginRecord, writeSiteSettings } from "./site-settings";

const MAX_ADMIN_LOGIN_RECORDS = 30;
let settingsRecordsMigrated = false;

function toPlainRecord(record: AdminLoginRecord): AdminLoginRecord {
  return {
    username: record.username,
    ip: record.ip,
    userAgent: record.userAgent,
    loggedAt: record.loggedAt,
  };
}

export function recordAdminLogin(username: string, ip: string, userAgent: string) {
  migrateSettingsLoginRecords();
  getDb()
    .prepare(
      `INSERT INTO admin_login_records (username, ip, user_agent)
       VALUES (?, ?, ?)`,
    )
    .run(username, ip, userAgent.slice(0, 240));
}

function migrateSettingsLoginRecords() {
  if (settingsRecordsMigrated) {
    return;
  }
  settingsRecordsMigrated = true;

  const settings = readSiteSettings();
  const records = settings.adminLoginRecords.map(toPlainRecord);
  if (!records.length) {
    return;
  }

  const insert = getDb().prepare(
    `INSERT INTO admin_login_records (username, ip, user_agent, logged_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const record of records) {
    insert.run(record.username, record.ip, record.userAgent.slice(0, 240), record.loggedAt);
  }

  writeSiteSettings({
    ...settings,
    adminLoginRecords: [],
  });
}

export function listAdminLoginRecords(limit = MAX_ADMIN_LOGIN_RECORDS): AdminLoginRecord[] {
  migrateSettingsLoginRecords();
  const rows = getDb()
    .prepare(
      `SELECT username, ip, user_agent, logged_at
       FROM admin_login_records
       ORDER BY logged_at DESC, id DESC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(Math.floor(limit), 1), 200)) as Array<{
    username: string;
    ip: string;
    user_agent: string;
    logged_at: string;
  }>;

  return rows.map((row) => ({
    username: row.username,
    ip: row.ip,
    userAgent: row.user_agent,
    loggedAt: row.logged_at,
  }));
}
