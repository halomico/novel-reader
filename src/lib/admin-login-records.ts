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

  const settings = readSiteSettings();
  const records = settings.adminLoginRecords.map(toPlainRecord);
  if (!records.length) {
    settingsRecordsMigrated = true;
    return;
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO admin_login_records (username, ip, user_agent, logged_at)
     SELECT ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM admin_login_records
       WHERE username = ? AND ip = ? AND user_agent = ? AND logged_at = ?
     )`,
  );
  db.exec("BEGIN");
  try {
    for (const record of records) {
      const userAgent = record.userAgent.slice(0, 240);
      insert.run(
        record.username,
        record.ip,
        userAgent,
        record.loggedAt,
        record.username,
        record.ip,
        userAgent,
        record.loggedAt,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  writeSiteSettings({
    ...settings,
    adminLoginRecords: [],
  });
  settingsRecordsMigrated = true;
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

export function listAdminLoginRecordPage(pageValue: number, pageSizeValue = 15) {
  migrateSettingsLoginRecords();
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(pageSizeValue) || 15, 1), 100);
  const total = (db.prepare("SELECT COUNT(*) AS count FROM admin_login_records").get() as { count: number }).count;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(Math.floor(pageValue) || 1, 1), totalPages);
  const rows = db
    .prepare(
      `SELECT username, ip, user_agent, logged_at
       FROM admin_login_records
       ORDER BY logged_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(pageSize, (page - 1) * pageSize) as Array<{
    username: string;
    ip: string;
    user_agent: string;
    logged_at: string;
  }>;

  return {
    records: rows.map((row) => ({
      username: row.username,
      ip: row.ip,
      userAgent: row.user_agent,
      loggedAt: row.logged_at,
    })),
    page,
    pageSize,
    total,
    totalPages,
  };
}
