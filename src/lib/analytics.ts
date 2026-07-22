import { randomUUID } from "node:crypto";
import { getClientIp } from "./admin-access";
import { isAnalyticsEnabled } from "./config";
import { getDb } from "./db";
import { parseSearchQuery } from "./search-query";

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

export type SearchQueryMode = "title" | "content";
export type SearchQuerySource = "direct" | "header_title" | "header_content" | "reader_current" | "reader_hotword" | "advanced_tags";

export type SearchQueryEventDetail = {
  id: number;
  mode: SearchQueryMode;
  source: SearchQuerySource;
  userLabel: string;
  originNovelTitle: string;
  resultCount: number | null;
  resultNovelCount: number | null;
  clickCount: number;
  lastClickedNovelTitle: string;
  createdAt: string;
};

export type SearchQueryDetails = {
  query: string;
  terms: string[];
  sources: AnalyticsMetric[];
  totalSearches: number;
  totalResults: number;
  totalResultNovels: number;
  clickedSearches: number;
  totalClicks: number;
  events: SearchQueryEventDetail[];
  page: number;
  pageSize: number;
  totalPages: number;
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
  totalSearches: number;
  topSearchQueries: AnalyticsMetric[];
  searchQueryPage: number;
  searchQueryPageSize: number;
  searchQueryTotal: number;
  searchQueryTotalPages: number;
  topContent: AnalyticsMetric[];
  contentPage: number;
  contentPageSize: number;
  contentTotal: number;
  contentTotalPages: number;
  topTags: AnalyticsMetric[];
  tagPage: number;
  tagPageSize: number;
  tagTotal: number;
  tagTotalPages: number;
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
  tagId?: number | null;
}) {
  if (!isAnalyticsEnabled()) {
    return;
  }

  const userAgent = params.headers.get("user-agent") || "";
  const parsed = parseUserAgent(userAgent);
  getDb()
    .prepare(
      `INSERT INTO analytics_events (user_id, event_type, path, referrer, ip, country, user_agent, device, browser, os, novel_id, media_id, tag_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      params.tagId ?? null,
    );
}

export function normalizeSearchAnalyticsQuery(value: string): string {
  return clampText(value.normalize("NFKC").replace(/\s+/gu, " "), 200).toLocaleLowerCase();
}

const SEARCH_QUERY_SOURCES = new Set<SearchQuerySource>([
  "direct",
  "header_title",
  "header_content",
  "reader_current",
  "reader_hotword",
  "advanced_tags",
]);

export function normalizeSearchQuerySource(value: string | null | undefined): SearchQuerySource {
  return SEARCH_QUERY_SOURCES.has(value as SearchQuerySource) ? value as SearchQuerySource : "direct";
}

function normalizeSearchEventKey(value: string | null | undefined): string {
  const key = value?.trim().toLowerCase() || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key) ? key : "";
}

function normalizeSearchResultCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(Math.max(Math.floor(value), 0), 1_000_000);
}

function existingNovelId(value: number | null | undefined): number | null {
  const id = Number(value || 0);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }
  return getDb().prepare("SELECT id FROM novels WHERE id = ?").get(id) ? id : null;
}

export function recordSearchQuery(
  queryValue: string,
  mode: SearchQueryMode,
  options: {
    source?: string | null;
    userId?: number | null;
    originNovelId?: number | null;
    resultCount?: number | null;
    resultNovelCount?: number | null;
  } = {},
): string | null {
  if (!isAnalyticsEnabled()) {
    return null;
  }
  const query = normalizeSearchAnalyticsQuery(queryValue);
  if (!query) {
    return null;
  }
  const db = getDb();
  const eventKey = randomUUID();
  const userId = Number.isInteger(options.userId) && Number(options.userId) > 0 ? Number(options.userId) : null;
  const result = db
    .prepare(
      `INSERT INTO search_query_events
         (event_key, query, mode, source, user_id, origin_novel_id, result_count, result_novel_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      eventKey,
      query,
      mode,
      normalizeSearchQuerySource(options.source),
      userId,
      existingNovelId(options.originNovelId),
      normalizeSearchResultCount(options.resultCount),
      normalizeSearchResultCount(options.resultNovelCount),
    );
  const eventId = Number(result.lastInsertRowid);
  const parsedQuery = parseSearchQuery(query, { mode });
  const terms = parsedQuery.ok ? parsedQuery.terms : query.split(" ").filter(Boolean);
  const insertTerm = db.prepare("INSERT INTO search_query_terms (search_event_id, term, position) VALUES (?, ?, ?)");
  terms.forEach((term, position) => insertTerm.run(eventId, term, position));
  return eventKey;
}

export function resolveSearchQueryEventKey(eventKeyValue: string | null | undefined, queryValue: string): string | null {
  if (!isAnalyticsEnabled()) {
    return null;
  }
  const eventKey = normalizeSearchEventKey(eventKeyValue);
  const query = normalizeSearchAnalyticsQuery(queryValue);
  if (!eventKey || !query) {
    return null;
  }
  const found = getDb()
    .prepare("SELECT 1 AS found FROM search_query_events WHERE event_key = ? AND query = ?")
    .get(eventKey, query);
  return found ? eventKey : null;
}

export function updateSearchQueryResults(
  eventKeyValue: string,
  resultCountValue: number,
  resultNovelCountValue: number,
): boolean {
  if (!isAnalyticsEnabled()) {
    return false;
  }
  const eventKey = normalizeSearchEventKey(eventKeyValue);
  const resultCount = normalizeSearchResultCount(resultCountValue);
  const resultNovelCount = normalizeSearchResultCount(resultNovelCountValue);
  if (!eventKey || resultCount === null || resultNovelCount === null) {
    return false;
  }
  const result = getDb()
    .prepare("UPDATE search_query_events SET result_count = ?, result_novel_count = ? WHERE event_key = ?")
    .run(resultCount, resultNovelCount, eventKey);
  return Number(result.changes) > 0;
}

export function recordSearchResultClick(eventKeyValue: string, novelIdValue: number, segmentIndexValue?: number | null): boolean {
  if (!isAnalyticsEnabled()) {
    return false;
  }
  const eventKey = normalizeSearchEventKey(eventKeyValue);
  const novelId = existingNovelId(novelIdValue);
  const segmentIndex = Number.isInteger(segmentIndexValue) && Number(segmentIndexValue) >= 0 ? Number(segmentIndexValue) : null;
  if (!eventKey || !novelId) {
    return false;
  }
  const event = getDb().prepare("SELECT id FROM search_query_events WHERE event_key = ?").get(eventKey) as { id: number } | undefined;
  if (!event) {
    return false;
  }
  getDb()
    .prepare("INSERT INTO search_result_clicks (search_event_id, novel_id, segment_index) VALUES (?, ?, ?)")
    .run(event.id, novelId, segmentIndex);
  return true;
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

export function getSearchQueryDetails(
  queryValue: string,
  rangeValue: string | undefined,
  options: { page?: number | string; pageSize?: number; customFrom?: string; customTo?: string } = {},
): SearchQueryDetails | null {
  const query = normalizeSearchAnalyticsQuery(queryValue);
  if (!query) {
    return null;
  }
  const filter = resolveAnalyticsTimeFilter(rangeValue, options.customFrom, options.customTo);
  const time = timeCondition(filter, "s.created_at");
  const where = `s.query = ? AND ${time.sql}`;
  const params: Array<string | number> = [query, ...time.params];
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || 30), 1), 100);
  const totals = getDb()
    .prepare(
      `SELECT COUNT(*) AS total_searches,
              COALESCE(SUM(result_count), 0) AS total_results,
              COALESCE(SUM(result_novel_count), 0) AS total_result_novels
       FROM search_query_events s
       WHERE ${where}`,
    )
    .get(...params) as { total_searches: number; total_results: number; total_result_novels: number };
  if (!totals.total_searches) {
    return null;
  }
  const clickTotals = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT c.search_event_id) AS clicked_searches, COUNT(c.id) AS total_clicks
       FROM search_result_clicks c
       INNER JOIN search_query_events s ON s.id = c.search_event_id
       WHERE ${where}`,
    )
    .get(...params) as { clicked_searches: number; total_clicks: number };
  const totalPages = Math.max(1, Math.ceil(totals.total_searches / pageSize));
  const page = normalizePositivePage(options.page, totalPages);
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.mode, s.source, s.result_count, s.result_novel_count, s.created_at,
              COALESCE(NULLIF(u.display_name, ''), u.username, '访客') AS user_label,
              COALESCE(origin.title, '') AS origin_novel_title,
              (SELECT COUNT(*) FROM search_result_clicks c WHERE c.search_event_id = s.id) AS click_count,
              COALESCE((
                SELECT clicked.title
                FROM search_result_clicks c
                INNER JOIN novels clicked ON clicked.id = c.novel_id
                WHERE c.search_event_id = s.id
                ORDER BY c.clicked_at DESC, c.id DESC
                LIMIT 1
              ), '') AS last_clicked_novel_title
       FROM search_query_events s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN novels origin ON origin.id = s.origin_novel_id
       WHERE ${where}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Array<{
      id: number;
      mode: SearchQueryMode;
      source: string;
      result_count: number | null;
      result_novel_count: number | null;
      created_at: string;
      user_label: string;
      origin_novel_title: string;
      click_count: number;
      last_clicked_novel_title: string;
    }>;
  const sourceRows = getDb()
    .prepare(
      `SELECT s.source AS label, COUNT(*) AS count
       FROM search_query_events s
       WHERE ${where}
       GROUP BY s.source
       ORDER BY count DESC, label ASC`,
    )
    .all(...params) as Array<{ label: string; count: number }>;
  const termRows = getDb()
    .prepare(
      `SELECT t.term, MIN(t.position) AS first_position
       FROM search_query_terms t
       INNER JOIN search_query_events s ON s.id = t.search_event_id
       WHERE ${where}
       GROUP BY t.term
       ORDER BY first_position ASC, t.term ASC`,
    )
    .all(...params) as Array<{ term: string }>;

  return {
    query,
    terms: termRows.map((row) => row.term),
    sources: sourceRows,
    totalSearches: totals.total_searches,
    totalResults: totals.total_results,
    totalResultNovels: totals.total_result_novels,
    clickedSearches: clickTotals.clicked_searches,
    totalClicks: clickTotals.total_clicks,
    events: rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      source: normalizeSearchQuerySource(row.source),
      userLabel: row.user_label,
      originNovelTitle: row.origin_novel_title,
      resultCount: row.result_count,
      resultNovelCount: row.result_novel_count,
      clickCount: row.click_count,
      lastClickedNovelTitle: row.last_clicked_novel_title,
      createdAt: row.created_at,
    })),
    page,
    pageSize,
    totalPages,
  };
}

export function getAnalyticsOverview(
  rangeValue: string | undefined,
  options: {
    realtimeLimit?: number;
    realtimePage?: number | string;
    realtimePageSize?: number;
    searchQueryPage?: number | string;
    searchQueryPageSize?: number;
    contentPage?: number | string;
    contentPageSize?: number;
    tagPage?: number | string;
    tagPageSize?: number;
    customFrom?: string;
    customTo?: string;
  } = {},
): AnalyticsOverview {
  const filter = resolveAnalyticsTimeFilter(rangeValue, options.customFrom, options.customTo);
  const eventWhere = contentTimeWhere(filter);
  const contentWhere = contentTimeWhere(filter, "e.created_at", "e.novel_id", "e.media_id");
  const searchTime = timeCondition(filter, "created_at");
  const tagTime = timeCondition(filter, "e.created_at");
  const realtimeLimit = Math.min(Math.max(Math.floor(options.realtimeLimit || 300), 30), 2000);
  const realtimePageSize = Math.min(Math.max(Math.floor(options.realtimePageSize || 30), 1), 100);
  const searchQueryPageSize = Math.min(Math.max(Math.floor(options.searchQueryPageSize || 100), 1), 100);
  const contentPageSize = Math.min(Math.max(Math.floor(options.contentPageSize || 50), 1), 100);
  const tagPageSize = Math.min(Math.max(Math.floor(options.tagPageSize || 50), 1), 100);
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
  const searchQueryTotal = oneCount(
    `SELECT COUNT(DISTINCT query) AS count FROM search_query_events WHERE ${searchTime.sql}`,
    searchTime.params,
  );
  const searchQueryTotalPages = Math.max(1, Math.ceil(searchQueryTotal / searchQueryPageSize));
  const searchQueryPage = normalizePositivePage(options.searchQueryPage, searchQueryTotalPages);
  const searchQueryOffset = (searchQueryPage - 1) * searchQueryPageSize;
  const contentTotal = oneCount(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT COALESCE(n.title, m.title, e.path)
       FROM analytics_events e
       LEFT JOIN novels n ON n.id = e.novel_id
       LEFT JOIN media_assets m ON m.id = e.media_id
       WHERE ${contentWhere.sql}
       GROUP BY COALESCE(n.title, m.title, e.path)
     )`,
    contentWhere.params,
  );
  const contentTotalPages = Math.max(1, Math.ceil(contentTotal / contentPageSize));
  const contentPage = normalizePositivePage(options.contentPage, contentTotalPages);
  const contentOffset = (contentPage - 1) * contentPageSize;
  const tagTotal = oneCount(
    `SELECT COUNT(DISTINCT e.tag_id) AS count
     FROM analytics_events e
     WHERE e.event_type = 'tag_click' AND e.tag_id IS NOT NULL AND ${tagTime.sql}`,
    tagTime.params,
  );
  const tagTotalPages = Math.max(1, Math.ceil(tagTotal / tagPageSize));
  const tagPage = normalizePositivePage(options.tagPage, tagTotalPages);
  const tagOffset = (tagPage - 1) * tagPageSize;

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
    totalSearches: oneCount(
      `SELECT COUNT(*) AS count FROM search_query_events WHERE ${searchTime.sql}`,
      searchTime.params,
    ),
    topSearchQueries: topMetrics(
      `SELECT query AS label, COUNT(*) AS count
       FROM search_query_events
       WHERE ${searchTime.sql}
       GROUP BY query
       ORDER BY count DESC, MAX(created_at) DESC, label ASC
       LIMIT ? OFFSET ?`,
      [...searchTime.params, searchQueryPageSize, searchQueryOffset],
    ),
    searchQueryPage,
    searchQueryPageSize,
    searchQueryTotal,
    searchQueryTotalPages,
    topContent: topMetrics(
      `SELECT COALESCE(n.title, m.title, e.path) AS label, COUNT(*) AS count
       FROM analytics_events e
       LEFT JOIN novels n ON n.id = e.novel_id
       LEFT JOIN media_assets m ON m.id = e.media_id
       WHERE ${contentWhere.sql}
       GROUP BY COALESCE(n.title, m.title, e.path)
       ORDER BY count DESC, label ASC
       LIMIT ? OFFSET ?`,
      [...contentWhere.params, contentPageSize, contentOffset],
    ),
    contentPage,
    contentPageSize,
    contentTotal,
    contentTotalPages,
    topTags: topMetrics(
      `SELECT t.name AS label, COUNT(*) AS count
       FROM analytics_events e
       INNER JOIN tags t ON t.id = e.tag_id
       WHERE e.event_type = 'tag_click' AND ${tagTime.sql}
       GROUP BY e.tag_id, t.name
       ORDER BY count DESC, MAX(e.created_at) DESC, t.name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`,
      [...tagTime.params, tagPageSize, tagOffset],
    ),
    tagPage,
    tagPageSize,
    tagTotal,
    tagTotalPages,
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
