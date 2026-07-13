import { getClientIp } from "./admin-access";
import { isAnalyticsEnabled } from "./config";
import { getDb } from "./db";

export type AnalyticsRange = "24h" | "7d" | "30d" | "custom";
type AnalyticsPresetRange = Exclude<AnalyticsRange, "custom">;

export type UserAgentInfo = {
  device: string;
  browser: string;
  os: string;
};

export type AnalyticsMetric = {
  label: string;
  count: number;
};

export type AnalyticsRealtimeEvent = {
  id: number;
  contentTitle: string;
  contentType: "novel" | "video" | "audio" | "file" | "unknown";
  referrer: string;
  ip: string;
  country: string;
  browser: string;
  os: string;
  device: string;
  createdAt: string;
};

export type AnalyticsOverview = {
  range: AnalyticsRange;
  customFrom?: string;
  customTo?: string;
  totalViews: number;
  uniqueIps: number;
  activeNow: number;
  topContent: AnalyticsMetric[];
  topIps: AnalyticsMetric[];
  topCountries: AnalyticsMetric[];
  topReferrers: AnalyticsMetric[];
  devices: AnalyticsMetric[];
  browsers: AnalyticsMetric[];
  operatingSystems: AnalyticsMetric[];
  realtime: AnalyticsRealtimeEvent[];
  realtimePage: number;
  realtimePageSize: number;
  realtimeTotal: number;
  realtimeTotalPages: number;
};

const RANGE_MODIFIERS: Record<AnalyticsPresetRange, string> = {
  "24h": "-24 hours",
  "7d": "-7 days",
  "30d": "-30 days",
};

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type TimeBound = {
  operator: ">=" | "<";
  value: string;
};

type AnalyticsTimeFilter = {
  range: AnalyticsRange;
  customFrom?: string;
  customTo?: string;
  presetModifier?: string;
  bounds?: TimeBound[];
};

function clampText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function normalizeUnknown(value: string | null | undefined, fallback = "unknown"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function normalizeAnalyticsRange(value: string | undefined): AnalyticsRange {
  return value === "7d" || value === "30d" || value === "custom" ? value : "24h";
}

function normalizeDateInput(value: string | undefined): string | undefined {
  const match = DATE_INPUT_PATTERN.exec(value?.trim() || "");
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function nextDateInput(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function resolveAnalyticsTimeFilter(rangeValue: string | undefined, customFromValue: string | undefined, customToValue: string | undefined): AnalyticsTimeFilter {
  const range = normalizeAnalyticsRange(rangeValue);
  if (range === "custom") {
    let customFrom = normalizeDateInput(customFromValue);
    let customTo = normalizeDateInput(customToValue);
    if (customFrom && customTo && customFrom > customTo) {
      [customFrom, customTo] = [customTo, customFrom];
    }

    const bounds: TimeBound[] = [];
    if (customFrom) {
      bounds.push({ operator: ">=", value: `${customFrom} 00:00:00` });
    }
    if (customTo) {
      bounds.push({ operator: "<", value: `${nextDateInput(customTo)} 00:00:00` });
    }
    if (bounds.length) {
      return { range: "custom", customFrom, customTo, bounds };
    }
  }

  const presetRange: AnalyticsPresetRange = range === "custom" ? "24h" : range;
  return { range: presetRange, presetModifier: RANGE_MODIFIERS[presetRange] };
}

function timeCondition(filter: AnalyticsTimeFilter, column: string): { sql: string; params: Array<string | number> } {
  if (filter.presetModifier) {
    return { sql: `${column} >= datetime('now', ?)`, params: [filter.presetModifier] };
  }
  const bounds = filter.bounds || [];
  return {
    sql: bounds.map((bound) => `${column} ${bound.operator} ?`).join(" AND "),
    params: bounds.map((bound) => bound.value),
  };
}

function contentTimeWhere(filter: AnalyticsTimeFilter, createdAtColumn = "created_at", novelIdColumn = "novel_id", mediaIdColumn = "media_id") {
  const time = timeCondition(filter, createdAtColumn);
  return {
    sql: `(${novelIdColumn} IS NOT NULL OR ${mediaIdColumn} IS NOT NULL) AND ${time.sql}`,
    params: time.params,
  };
}

export function parseUserAgent(userAgent: string): UserAgentInfo {
  const ua = userAgent.toLowerCase();
  const isBot = /bot|crawler|spider|slurp|headless|phantom|selenium|playwright/.test(ua);
  const isTablet = /ipad|tablet/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua));
  const isMobile = !isTablet && /iphone|ipod|android.*mobile|windows phone|mobile/.test(ua);
  const device = isBot ? "bot" : isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let browser = "unknown";
  if (/edg\//.test(ua)) {
    browser = "edge";
  } else if (/opr\/|opera/.test(ua)) {
    browser = "opera";
  } else if (/micromessenger/.test(ua)) {
    browser = "wechat";
  } else if (/samsungbrowser/.test(ua)) {
    browser = "samsung";
  } else if (/firefox\//.test(ua)) {
    browser = "firefox";
  } else if (/chrome\/|crios\//.test(ua)) {
    browser = "chrome";
  } else if (/safari\//.test(ua)) {
    browser = "safari";
  }

  let os = "unknown";
  if (/windows/.test(ua)) {
    os = "windows";
  } else if (/iphone|ipad|ipod/.test(ua)) {
    os = "ios";
  } else if (/android/.test(ua)) {
    os = "android";
  } else if (/mac os x|macintosh/.test(ua)) {
    os = "macos";
  } else if (/linux/.test(ua)) {
    os = "linux";
  }

  return { device, browser, os };
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      return clampText(`${url.pathname}${url.search}`, 320) || "/";
    } catch {
      return "/";
    }
  }
  return clampText(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, 320);
}

function normalizeReferrer(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "direct";
  }
  try {
    const url = new URL(trimmed);
    return clampText(url.host || trimmed, 180);
  } catch {
    return clampText(trimmed, 180);
  }
}

function normalizeCountry(headers: Headers): string {
  const country = headers.get("cf-ipcountry") || headers.get("x-vercel-ip-country") || headers.get("x-country-code") || "";
  const normalized = country.trim().toUpperCase();
  return normalized && normalized !== "XX" ? normalized.slice(0, 32) : "unknown";
}

export function recordAnalyticsEvent(params: {
  headers: Headers;
  userId?: number | null;
  eventType?: string;
  path: string;
  referrer?: string | null;
  novelId?: number | null;
  mediaId?: number | null;
}) {
  if (!isAnalyticsEnabled()) {
    return;
  }

  const userAgent = params.headers.get("user-agent") || "";
  const parsed = parseUserAgent(userAgent);
  getDb()
    .prepare(
      `INSERT INTO analytics_events (user_id, event_type, path, referrer, ip, country, user_agent, device, browser, os, novel_id, media_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.userId ?? null,
      clampText(params.eventType || "book_view", 48),
      normalizePath(params.path),
      normalizeReferrer(params.referrer),
      getClientIp(params.headers),
      normalizeCountry(params.headers),
      userAgent.slice(0, 240),
      parsed.device,
      parsed.browser,
      parsed.os,
      params.novelId ?? null,
      params.mediaId ?? null,
    );
}

function oneCount(sql: string, params: Array<string | number>): number {
  const row = getDb().prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count || 0;
}

function topMetrics(sql: string, params: Array<string | number>): AnalyticsMetric[] {
  const rows = getDb().prepare(sql).all(...params) as Array<{ label: string | null; count: number }>;
  return rows.map((row) => ({
    label: normalizeUnknown(row.label),
    count: row.count,
  }));
}

function normalizePositivePage(value: number | string | undefined, totalPages: number): number {
  const page = Number(value || 1);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

export function getAnalyticsOverview(
  rangeValue: string | undefined,
  options: { realtimeLimit?: number; realtimePage?: number | string; realtimePageSize?: number; customFrom?: string; customTo?: string } = {},
): AnalyticsOverview {
  const filter = resolveAnalyticsTimeFilter(rangeValue, options.customFrom, options.customTo);
  const eventWhere = contentTimeWhere(filter);
  const realtimeLimit = Math.min(Math.max(Math.floor(options.realtimeLimit || 300), 30), 2000);
  const realtimePageSize = Math.min(Math.max(Math.floor(options.realtimePageSize || 30), 1), 100);
  const totalViews = oneCount(
    `SELECT COUNT(*) AS count FROM analytics_events WHERE ${eventWhere.sql}`,
    eventWhere.params,
  );
  const uniqueIps = oneCount(
    `SELECT COUNT(DISTINCT ip) AS count FROM analytics_events WHERE ${eventWhere.sql}`,
    eventWhere.params,
  );
  const activeRow = getDb()
    .prepare("SELECT COUNT(DISTINCT ip) AS count FROM analytics_events WHERE created_at >= datetime('now', '-5 minutes') AND (novel_id IS NOT NULL OR media_id IS NOT NULL)")
    .get() as { count: number } | undefined;
  const realtimeTotalRow = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT id
         FROM analytics_events
         WHERE ${eventWhere.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?
       )`,
    )
    .get(...eventWhere.params, realtimeLimit) as { count: number } | undefined;
  const realtimeTotal = realtimeTotalRow?.count || 0;
  const realtimeTotalPages = Math.max(1, Math.ceil(realtimeTotal / realtimePageSize));
  const realtimePage = normalizePositivePage(options.realtimePage, realtimeTotalPages);
  const realtimeOffset = (realtimePage - 1) * realtimePageSize;

  const realtimeRows = getDb()
    .prepare(
      `SELECT e.id,
              COALESCE(n.title, m.title, e.path) AS content_title,
              CASE WHEN e.novel_id IS NOT NULL THEN 'novel' ELSE COALESCE(m.kind, 'unknown') END AS content_type,
              e.referrer, e.ip, e.country, e.browser, e.os, e.device, e.created_at
       FROM (
         SELECT *
         FROM analytics_events
         WHERE ${eventWhere.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?
       ) e
       LEFT JOIN novels n ON n.id = e.novel_id
       LEFT JOIN media_assets m ON m.id = e.media_id
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...eventWhere.params, realtimeLimit, realtimePageSize, realtimeOffset) as Array<{
    id: number;
    content_title: string;
    content_type: "novel" | "video" | "audio" | "file" | "unknown";
    referrer: string | null;
    ip: string;
    country: string | null;
    browser: string;
    os: string;
    device: string;
    created_at: string;
  }>;

  return {
    range: filter.range,
    customFrom: filter.customFrom,
    customTo: filter.customTo,
    totalViews,
    uniqueIps,
    activeNow: activeRow?.count || 0,
    topContent: topMetrics(
      `SELECT COALESCE(n.title, m.title, e.path) AS label, COUNT(*) AS count
       FROM analytics_events e
       LEFT JOIN novels n ON n.id = e.novel_id
       LEFT JOIN media_assets m ON m.id = e.media_id
       WHERE ${contentTimeWhere(filter, "e.created_at", "e.novel_id", "e.media_id").sql}
       GROUP BY COALESCE(n.title, m.title, e.path)
       ORDER BY count DESC, label ASC`,
      contentTimeWhere(filter, "e.created_at", "e.novel_id", "e.media_id").params,
    ),
    topIps: topMetrics(
      `SELECT ip AS label, COUNT(*) AS count
       FROM analytics_events
       WHERE ${eventWhere.sql}
       GROUP BY ip
       ORDER BY count DESC, label ASC`,
      eventWhere.params,
    ),
    topCountries: topMetrics(
      `SELECT country AS label, COUNT(*) AS count
       FROM analytics_events
       WHERE ${eventWhere.sql}
       GROUP BY country
       ORDER BY count DESC, label ASC`,
      eventWhere.params,
    ),
    topReferrers: topMetrics(
      `SELECT referrer AS label, COUNT(*) AS count
       FROM analytics_events
       WHERE ${eventWhere.sql}
       GROUP BY referrer
       ORDER BY count DESC, label ASC`,
      eventWhere.params,
    ),
    devices: topMetrics(
      `SELECT device AS label, COUNT(*) AS count
       FROM analytics_events
       WHERE ${eventWhere.sql}
       GROUP BY device
       ORDER BY count DESC, label ASC`,
      eventWhere.params,
    ),
    browsers: topMetrics(
      `SELECT browser AS label, COUNT(*) AS count
       FROM analytics_events
       WHERE ${eventWhere.sql}
       GROUP BY browser
       ORDER BY count DESC, label ASC`,
      eventWhere.params,
    ),
    operatingSystems: topMetrics(
      `SELECT os AS label, COUNT(*) AS count
       FROM analytics_events
       WHERE ${eventWhere.sql}
       GROUP BY os
       ORDER BY count DESC, label ASC`,
      eventWhere.params,
    ),
    realtime: realtimeRows.map((row) => ({
      id: row.id,
      contentTitle: row.content_title,
      contentType: row.content_type,
      referrer: row.referrer || "direct",
      ip: row.ip,
      country: row.country || "unknown",
      browser: row.browser,
      os: row.os,
      device: row.device,
      createdAt: row.created_at,
    })),
    realtimePage,
    realtimePageSize,
    realtimeTotal,
    realtimeTotalPages,
  };
}
