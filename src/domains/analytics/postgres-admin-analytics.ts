import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import { normalizePostgresSearchAnalyticsQuery, type SearchQueryMode, type SearchQuerySource } from "./postgres-search-analytics";

export type AnalyticsRange = "24h" | "7d" | "30d" | "custom";
export type AnalyticsMetric = { label: string; count: number };
export type AnalyticsRealtimeContentFilter = "all" | "novel" | "video" | "audio" | "file";
export type AnalyticsRealtimeEvent = {
  id: number; contentTitle: string; contentType: AnalyticsRealtimeContentFilter | "unknown";
  referrer: string; ip: string; country: string; browser: string; os: string; device: string; createdAt: string;
};
export type ReadingAnalytics = {
  opens: number; resumes: number; completions: number; averageProgress: number;
  novels: Array<{ id: number; label: string; opens: number; resumes: number; completions: number; averageProgress: number }>;
  users: Array<{ id: number; label: string; opens: number; resumes: number; completions: number }>;
};
export type AnalyticsOverviewOptions = {
  realtimeLimit?: number; realtimePage?: number | string; realtimePageSize?: number; realtimeContentType?: string;
  realtimeCountry?: string; searchQueryPage?: number | string; searchQueryPageSize?: number;
  contentPage?: number | string; contentPageSize?: number; tagPage?: number | string; tagPageSize?: number;
  customFrom?: string; customTo?: string;
};
export type AnalyticsOverview = {
  range: AnalyticsRange; customFrom?: string; customTo?: string; totalViews: number; uniqueIps: number;
  activeNow: number; totalSearches: number; topSearchQueries: AnalyticsMetric[]; searchQueryPage: number;
  searchQueryPageSize: number; searchQueryTotal: number; searchQueryTotalPages: number;
  topContent: AnalyticsMetric[]; contentPage: number; contentPageSize: number; contentTotal: number; contentTotalPages: number;
  topTags: AnalyticsMetric[]; tagPage: number; tagPageSize: number; tagTotal: number; tagTotalPages: number;
  topIps: AnalyticsMetric[]; topCountries: AnalyticsMetric[]; topReferrers: AnalyticsMetric[];
  devices: AnalyticsMetric[]; browsers: AnalyticsMetric[]; operatingSystems: AnalyticsMetric[];
  realtime: AnalyticsRealtimeEvent[]; realtimePage: number; realtimePageSize: number; realtimeTotal: number;
  realtimeTotalPages: number; realtimeContentType: AnalyticsRealtimeContentFilter; realtimeCountry: string;
  realtimeCountries: string[];
};
export type SearchQueryEventDetail = {
  id: number; mode: SearchQueryMode; source: SearchQuerySource; userLabel: string; originNovelTitle: string;
  resultCount: number | null; resultNovelCount: number | null; clickCount: number; lastClickedNovelTitle: string; createdAt: string;
};
export type SearchQueryDetails = {
  query: string; terms: string[]; sources: AnalyticsMetric[]; totalSearches: number; totalResults: number;
  totalResultNovels: number; clickedSearches: number; totalClicks: number; events: SearchQueryEventDetail[];
  page: number; pageSize: number; totalPages: number;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
function int(value: unknown): number { const parsed = Number(value ?? 0); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("PostgreSQL 返回了无效统计值"); return parsed; }
function iso(value: Date | string): string { const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) throw new Error("PostgreSQL 返回了无效统计时间"); return date.toISOString(); }
function page(value: number | string | undefined, totalPages: number): number { const parsed = Math.floor(Number(value || 1)); return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 1, 1), Math.max(totalPages, 1)); }
function size(value: number | undefined, fallback: number, max = 100): number { return Math.min(Math.max(Math.floor(value || fallback), 1), max); }
function dateValue(value: string | undefined): string | undefined {
  const match = DATE_PATTERN.exec(value?.trim() || ""); if (!match) return undefined;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
function timeFilter(rangeValue: string | undefined, fromValue?: string, toValue?: string) {
  let range: AnalyticsRange = rangeValue === "7d" || rangeValue === "30d" || rangeValue === "custom" ? rangeValue : "24h";
  let customFrom = dateValue(fromValue); let customTo = dateValue(toValue);
  if (range === "custom" && customFrom && customTo && customFrom > customTo) [customFrom, customTo] = [customTo, customFrom];
  if (range === "custom" && (customFrom || customTo)) {
    const values: unknown[] = []; const parts: string[] = [];
    if (customFrom) { values.push(`${customFrom}T00:00:00.000Z`); parts.push(`$COLUMN >= $${values.length}::timestamptz`); }
    if (customTo) { const next = new Date(`${customTo}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1); values.push(next.toISOString()); parts.push(`$COLUMN < $${values.length}::timestamptz`); }
    return { range, customFrom, customTo, values, sql: (column: string) => parts.join(" AND ").replaceAll("$COLUMN", column) };
  }
  if (range === "custom") range = "24h";
  const interval = range === "30d" ? "30 days" : range === "7d" ? "7 days" : "24 hours";
  return { range, customFrom: undefined, customTo: undefined, values: [] as unknown[], sql: (column: string) => `${column} >= clock_timestamp() - interval '${interval}'` };
}
function normalizeContentFilter(value: string | undefined): AnalyticsRealtimeContentFilter { return value === "novel" || value === "video" || value === "audio" || value === "file" ? value : "all"; }
function normalizeCountry(value: string | undefined): string { const country = value?.trim().toUpperCase() || ""; if (!country || country === "ALL") return "all"; if (country === "UNKNOWN") return "unknown"; return /^[A-Z0-9]{2,8}$/u.test(country) ? country : "all"; }
async function count(executor: SqlExecutor, text: string, values: readonly unknown[] = []): Promise<number> { const result = await executor.query<{ count: string | number }>({ text, values }); return int(result.rows[0]?.count); }
async function metrics(executor: SqlExecutor, text: string, values: readonly unknown[] = []): Promise<AnalyticsMetric[]> { const result = await executor.query<{ label: string | null; count: string | number }>({ text, values }); return result.rows.map((row) => ({ label: row.label?.trim() || "unknown", count: int(row.count) })); }

export async function getPostgresAdminAnalyticsOverview(executor: SqlExecutor, rangeValue: string | undefined, options: AnalyticsOverviewOptions = {}): Promise<AnalyticsOverview> {
  const time = timeFilter(rangeValue, options.customFrom, options.customTo); const eventTime = time.sql("e.created_at"); const searchTime = time.sql("s.created_at");
  const searchPageSize = size(options.searchQueryPageSize, 100); const contentPageSize = size(options.contentPageSize, 50); const tagPageSize = size(options.tagPageSize, 50);
  const [totalViews, uniqueIps, totalSearches, searchQueryTotal, contentTotal, tagTotal, activeNow] = await Promise.all([
    count(executor, `SELECT COUNT(*)::bigint AS count FROM analytics_events e WHERE (e.novel_id IS NOT NULL OR e.media_id IS NOT NULL) AND ${eventTime}`, time.values),
    count(executor, `SELECT COUNT(DISTINCT e.ip)::bigint AS count FROM analytics_events e WHERE (e.novel_id IS NOT NULL OR e.media_id IS NOT NULL) AND ${eventTime}`, time.values),
    count(executor, `SELECT COUNT(*)::bigint AS count FROM search_query_events s WHERE ${searchTime}`, time.values),
    count(executor, `SELECT COUNT(DISTINCT s.query)::bigint AS count FROM search_query_events s WHERE ${searchTime}`, time.values),
    count(executor, `SELECT COUNT(*)::bigint AS count FROM (SELECT COALESCE(n.title,m.title,e.path) FROM analytics_events e LEFT JOIN novels n ON n.id=e.novel_id LEFT JOIN media_assets m ON m.id=e.media_id WHERE (e.novel_id IS NOT NULL OR e.media_id IS NOT NULL) AND ${eventTime} GROUP BY COALESCE(n.title,m.title,e.path)) grouped`, time.values),
    count(executor, `SELECT COUNT(DISTINCT e.tag_id)::bigint AS count FROM analytics_events e WHERE e.event_type='tag_click' AND e.tag_id IS NOT NULL AND ${eventTime}`, time.values),
    count(executor, "SELECT COUNT(DISTINCT ip)::bigint AS count FROM analytics_events WHERE created_at >= clock_timestamp() - interval '5 minutes' AND (novel_id IS NOT NULL OR media_id IS NOT NULL)"),
  ]);
  const searchQueryTotalPages = Math.max(1, Math.ceil(searchQueryTotal / searchPageSize)); const searchQueryPage = page(options.searchQueryPage, searchQueryTotalPages);
  const contentTotalPages = Math.max(1, Math.ceil(contentTotal / contentPageSize)); const contentPage = page(options.contentPage, contentTotalPages);
  const tagTotalPages = Math.max(1, Math.ceil(tagTotal / tagPageSize)); const tagPage = page(options.tagPage, tagTotalPages);
  const baseCount = time.values.length; const paged = (limit: number, offset: number) => [...time.values, limit, offset];
  const metricQueries = await Promise.all([
    metrics(executor, `SELECT s.query AS label,COUNT(*)::bigint AS count FROM search_query_events s WHERE ${searchTime} GROUP BY s.query ORDER BY count DESC,MAX(s.created_at) DESC,s.query COLLATE "C" LIMIT $${baseCount + 1} OFFSET $${baseCount + 2}`, paged(searchPageSize, (searchQueryPage - 1) * searchPageSize)),
    metrics(executor, `SELECT COALESCE(n.title,m.title,e.path) AS label,COUNT(*)::bigint AS count FROM analytics_events e LEFT JOIN novels n ON n.id=e.novel_id LEFT JOIN media_assets m ON m.id=e.media_id WHERE (e.novel_id IS NOT NULL OR e.media_id IS NOT NULL) AND ${eventTime} GROUP BY COALESCE(n.title,m.title,e.path) ORDER BY count DESC,COALESCE(n.title,m.title,e.path) COLLATE "C" LIMIT $${baseCount + 1} OFFSET $${baseCount + 2}`, paged(contentPageSize, (contentPage - 1) * contentPageSize)),
    metrics(executor, `SELECT t.name AS label,COUNT(*)::bigint AS count FROM analytics_events e JOIN tags t ON t.id=e.tag_id WHERE e.event_type='tag_click' AND ${eventTime} GROUP BY e.tag_id,t.name ORDER BY count DESC,MAX(e.created_at) DESC,t.name COLLATE "C" LIMIT $${baseCount + 1} OFFSET $${baseCount + 2}`, paged(tagPageSize, (tagPage - 1) * tagPageSize)),
    ...["e.ip", "e.country", "e.referrer", "e.device", "e.browser", "e.os"].map((column) => metrics(executor, `SELECT ${column} AS label,COUNT(*)::bigint AS count FROM analytics_events e WHERE (e.novel_id IS NOT NULL OR e.media_id IS NOT NULL) AND ${eventTime} GROUP BY ${column} ORDER BY count DESC,${column} COLLATE "C" NULLS LAST LIMIT 100`, time.values)),
  ]);
  const realtimeContentType = normalizeContentFilter(options.realtimeContentType); const realtimeCountry = normalizeCountry(options.realtimeCountry);
  const filters = [`(e.novel_id IS NOT NULL OR e.media_id IS NOT NULL)`, eventTime]; const realtimeValues = [...time.values];
  if (realtimeContentType === "novel") filters.push("e.novel_id IS NOT NULL");
  else if (realtimeContentType !== "all") { realtimeValues.push(realtimeContentType); filters.push(`EXISTS (SELECT 1 FROM media_assets filtered WHERE filtered.id=e.media_id AND filtered.kind=$${realtimeValues.length})`); }
  if (realtimeCountry === "unknown") filters.push("(e.country IS NULL OR btrim(e.country)='' OR lower(btrim(e.country))='unknown')");
  else if (realtimeCountry !== "all") { realtimeValues.push(realtimeCountry); filters.push(`upper(e.country)=$${realtimeValues.length}`); }
  const realtimeLimit = Math.min(Math.max(Math.floor(options.realtimeLimit || 300), 30), 10_000);
  const realtimeTotal = await count(executor, `SELECT COUNT(*)::bigint AS count FROM (SELECT e.id FROM analytics_events e WHERE ${filters.join(" AND ")} ORDER BY e.created_at DESC,e.id DESC LIMIT $${realtimeValues.length + 1}) limited`, [...realtimeValues, realtimeLimit]);
  const realtimePageSize = size(options.realtimePageSize, 30); const realtimeTotalPages = Math.max(1, Math.ceil(realtimeTotal / realtimePageSize)); const realtimePage = page(options.realtimePage, realtimeTotalPages);
  const realtimeRows = await executor.query<QueryResultRow & { id: string | number; content_title: string; content_type: AnalyticsRealtimeEvent["contentType"]; referrer: string | null; ip: string; country: string | null; browser: string; os: string; device: string; created_at: Date | string }>({ text: `SELECT e.id,COALESCE(n.title,m.title,e.path) AS content_title,CASE WHEN e.novel_id IS NOT NULL THEN 'novel' ELSE COALESCE(m.kind,'unknown') END AS content_type,e.referrer,e.ip,e.country,e.browser,e.os,e.device,e.created_at FROM analytics_events e LEFT JOIN novels n ON n.id=e.novel_id LEFT JOIN media_assets m ON m.id=e.media_id WHERE ${filters.join(" AND ")} ORDER BY e.created_at DESC,e.id DESC LIMIT $${realtimeValues.length + 1} OFFSET $${realtimeValues.length + 2}`, values: [...realtimeValues, realtimePageSize, (realtimePage - 1) * realtimePageSize] });
  const countryFilters = [`(e.novel_id IS NOT NULL OR e.media_id IS NOT NULL)`, eventTime]; const countryValues = [...time.values]; if (realtimeContentType === "novel") countryFilters.push("e.novel_id IS NOT NULL"); else if (realtimeContentType !== "all") { countryValues.push(realtimeContentType); countryFilters.push(`EXISTS (SELECT 1 FROM media_assets filtered WHERE filtered.id=e.media_id AND filtered.kind=$${countryValues.length})`); }
  const countries = await executor.query<{ country: string }>({ text: `SELECT CASE WHEN e.country IS NULL OR btrim(e.country)='' OR lower(btrim(e.country))='unknown' THEN 'unknown' ELSE upper(btrim(e.country)) END AS country FROM analytics_events e WHERE ${countryFilters.join(" AND ")} GROUP BY 1 ORDER BY COUNT(*) DESC,CASE WHEN e.country IS NULL OR btrim(e.country)='' OR lower(btrim(e.country))='unknown' THEN 'unknown' ELSE upper(btrim(e.country)) END COLLATE "C" LIMIT 250`, values: countryValues });
  return { range: time.range, customFrom: time.customFrom, customTo: time.customTo, totalViews, uniqueIps, activeNow, totalSearches,
    topSearchQueries: metricQueries[0], searchQueryPage, searchQueryPageSize: searchPageSize, searchQueryTotal, searchQueryTotalPages,
    topContent: metricQueries[1], contentPage, contentPageSize, contentTotal, contentTotalPages,
    topTags: metricQueries[2], tagPage, tagPageSize, tagTotal, tagTotalPages,
    topIps: metricQueries[3], topCountries: metricQueries[4], topReferrers: metricQueries[5], devices: metricQueries[6], browsers: metricQueries[7], operatingSystems: metricQueries[8],
    realtime: realtimeRows.rows.map((row) => ({ id: int(row.id), contentTitle: row.content_title, contentType: row.content_type, referrer: row.referrer || "direct", ip: row.ip, country: row.country || "unknown", browser: row.browser, os: row.os, device: row.device, createdAt: iso(row.created_at) })),
    realtimePage, realtimePageSize, realtimeTotal, realtimeTotalPages, realtimeContentType, realtimeCountry, realtimeCountries: countries.rows.map((row) => row.country) };
}

export async function getPostgresReadingAnalytics(executor: SqlExecutor, days = 30, limit = 10): Promise<ReadingAnalytics> {
  const normalizedDays = Math.min(Math.max(Math.floor(days), 1), 365); const normalizedLimit = size(limit, 10);
  const [summary, novels, users] = await Promise.all([
    executor.query<{ opens: string; resumes: string; completions: string; progress_sum: string; progress_samples: string }>({ text: `SELECT COALESCE(SUM(open_count),0)::bigint AS opens,COALESCE(SUM(resume_count),0)::bigint AS resumes,COALESCE(SUM(completion_count),0)::bigint AS completions,COALESCE(SUM(progress_percent_sum),0)::bigint AS progress_sum,COALESCE(SUM(progress_sample_count),0)::bigint AS progress_samples FROM novel_read_daily_stats WHERE day >= CURRENT_DATE - ($1::integer - 1)`, values: [normalizedDays] }),
    executor.query<QueryResultRow & { id: number; label: string; opens: string; resumes: string; completions: string; average_progress: string | number }>({ text: `SELECT n.id,n.title AS label,SUM(s.open_count)::bigint AS opens,SUM(s.resume_count)::bigint AS resumes,SUM(s.completion_count)::bigint AS completions,COALESCE(SUM(s.progress_percent_sum)::numeric/NULLIF(SUM(s.progress_sample_count),0),0) AS average_progress FROM novel_read_daily_stats s JOIN novels n ON n.id=s.novel_id WHERE s.day >= CURRENT_DATE - ($1::integer - 1) GROUP BY n.id,n.title ORDER BY opens DESC,resumes DESC,n.id LIMIT $2`, values: [normalizedDays, normalizedLimit] }),
    executor.query<QueryResultRow & { id: number; label: string; opens: string; resumes: string; completions: string }>({ text: `SELECT u.id,u.display_name AS label,SUM(s.open_count)::bigint AS opens,SUM(s.resume_count)::bigint AS resumes,SUM(s.completion_count)::bigint AS completions FROM user_read_daily_stats s JOIN users u ON u.id=s.user_id WHERE s.day >= CURRENT_DATE - ($1::integer - 1) GROUP BY u.id,u.display_name ORDER BY opens DESC,resumes DESC,u.id LIMIT $2`, values: [normalizedDays, normalizedLimit] }),
  ]);
  const row = summary.rows[0]; const samples = int(row?.progress_samples);
  return { opens: int(row?.opens), resumes: int(row?.resumes), completions: int(row?.completions), averageProgress: samples ? int(row?.progress_sum) / samples : 0,
    novels: novels.rows.map((item) => ({ id: item.id, label: item.label, opens: int(item.opens), resumes: int(item.resumes), completions: int(item.completions), averageProgress: Number(item.average_progress) || 0 })),
    users: users.rows.map((item) => ({ id: item.id, label: item.label, opens: int(item.opens), resumes: int(item.resumes), completions: int(item.completions) })) };
}

export async function getPostgresSearchQueryDetails(executor: SqlExecutor, queryValue: string, rangeValue: string | undefined, options: { page?: number | string; pageSize?: number; customFrom?: string; customTo?: string } = {}): Promise<SearchQueryDetails | null> {
  const query = normalizePostgresSearchAnalyticsQuery(queryValue); if (!query) return null; const time = timeFilter(rangeValue, options.customFrom, options.customTo); const values = [query, ...time.values]; const where = `s.query=$1 AND ${time.sql("s.created_at").replace(/\$(\d+)/gu, (_, value: string) => `$${Number(value) + 1}`)}`;
  const [totals, clicks, sources, terms] = await Promise.all([
    executor.query<{ total_searches: string; total_results: string; total_result_novels: string }>({ text: `SELECT COUNT(*)::bigint AS total_searches,COALESCE(SUM(result_count),0)::bigint AS total_results,COALESCE(SUM(result_novel_count),0)::bigint AS total_result_novels FROM search_query_events s WHERE ${where}`, values }),
    executor.query<{ clicked_searches: string; total_clicks: string }>({ text: `SELECT COUNT(DISTINCT c.search_event_id)::bigint AS clicked_searches,COUNT(c.id)::bigint AS total_clicks FROM search_result_clicks c JOIN search_query_events s ON s.id=c.search_event_id WHERE ${where}`, values }),
    metrics(executor, `SELECT s.source AS label,COUNT(*)::bigint AS count FROM search_query_events s WHERE ${where} GROUP BY s.source ORDER BY count DESC,label`, values),
    executor.query<{ term: string }>({ text: `SELECT t.term FROM search_query_terms t JOIN search_query_events s ON s.id=t.search_event_id WHERE ${where} GROUP BY t.term ORDER BY MIN(t.position),t.term COLLATE "C" LIMIT 50`, values }),
  ]);
  const totalSearches = int(totals.rows[0]?.total_searches); if (!totalSearches) return null; const pageSize = size(options.pageSize, 30); const totalPages = Math.max(1, Math.ceil(totalSearches / pageSize)); const currentPage = page(options.page, totalPages);
  const rows = await executor.query<QueryResultRow & { id: string | number; mode: SearchQueryMode; source: SearchQuerySource; result_count: string | number | null; result_novel_count: string | number | null; created_at: Date | string; user_label: string; origin_novel_title: string; click_count: string | number; last_clicked_novel_title: string }>({ text: `SELECT s.id,s.mode,s.source,s.result_count,s.result_novel_count,s.created_at,COALESCE(NULLIF(u.display_name,''),u.username,'访客') AS user_label,COALESCE(origin.title,'') AS origin_novel_title,(SELECT COUNT(*) FROM search_result_clicks c WHERE c.search_event_id=s.id)::bigint AS click_count,COALESCE((SELECT clicked.title FROM search_result_clicks c JOIN novels clicked ON clicked.id=c.novel_id WHERE c.search_event_id=s.id ORDER BY c.clicked_at DESC,c.id DESC LIMIT 1),'') AS last_clicked_novel_title FROM search_query_events s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN novels origin ON origin.id=s.origin_novel_id WHERE ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, values: [...values, pageSize, (currentPage - 1) * pageSize] });
  return { query, terms: terms.rows.map((row) => row.term), sources, totalSearches, totalResults: int(totals.rows[0]?.total_results), totalResultNovels: int(totals.rows[0]?.total_result_novels), clickedSearches: int(clicks.rows[0]?.clicked_searches), totalClicks: int(clicks.rows[0]?.total_clicks), events: rows.rows.map((row) => ({ id: int(row.id), mode: row.mode, source: row.source, userLabel: row.user_label, originNovelTitle: row.origin_novel_title, resultCount: row.result_count === null ? null : int(row.result_count), resultNovelCount: row.result_novel_count === null ? null : int(row.result_novel_count), clickCount: int(row.click_count), lastClickedNovelTitle: row.last_clicked_novel_title, createdAt: iso(row.created_at) })), page: currentPage, pageSize, totalPages };
}

export { normalizePostgresSearchAnalyticsQuery, type SearchQuerySource };
