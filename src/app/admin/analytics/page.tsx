import type { Metadata } from "next";
import { BookOpenText, CalendarDays, Globe2, ListFilter, MonitorSmartphone, MousePointerClick, Radio, Search, Tags, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { AdminSelect } from "@/components/AdminSelect";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Pagination } from "@/components/Pagination";
import {
  getCachedAdminAnalyticsSummary,
  getCachedAdminReadingAnalytics,
  getCachedAdminRealtimeCountries,
} from "@/lib/admin-analytics-cache";
import { getAnalyticsRealtimeActivity, type AnalyticsMetric } from "@/lib/analytics";
import { getAnalyticsRealtimeLimit, isAnalyticsEnabled } from "@/lib/config";
import type { ReadingAnalytics } from "@/lib/reading-progress";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminAnalyticsPageProps = {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    page?: string;
    realtimePage?: string;
    realtimeType?: string;
    realtimeCountry?: string;
    hotPage?: string;
    contentPage?: string;
    tagPage?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

const presetRanges = ["24h", "7d", "30d"] as const;
const rangeLabels: Record<(typeof presetRanges)[number], string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
};

const labelText: Record<string, string> = {
  unknown: "未知",
  direct: "直接访问",
  desktop: "桌面",
  mobile: "手机",
  tablet: "平板",
  bot: "脚本/爬虫",
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  opera: "Opera",
  wechat: "微信",
  samsung: "Samsung",
  windows: "Windows",
  macos: "macOS",
  ios: "iOS",
  android: "Android",
  linux: "Linux",
  book_view: "书籍访问",
  novel: "小说",
  video: "视频",
  audio: "音频",
  file: "文件",
};

function prettyLabel(value: string): string {
  return labelText[value] || value;
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

function MetricTable({
  title,
  items,
  total = items.length,
  page,
  totalPages,
  paginationParams,
  pageParam = "contentPage",
  sectionId,
}: {
  title: string;
  items: AnalyticsMetric[];
  total?: number;
  page?: number;
  totalPages?: number;
  paginationParams?: Record<string, string | undefined>;
  pageParam?: string;
  sectionId?: string;
}) {
  return (
    <details className="analyticsMetricPanel" id={sectionId} open>
      <summary>
        <h3>{title}</h3>
        <span>{total} 项</span>
      </summary>
      {items.length ? (
        <div className="analyticsMetricList">
          {items.map((item) => (
            <div className="analyticsMetricRow" key={`${title}-${item.label}`}>
              <span title={item.label}>{prettyLabel(item.label)}</span>
              <strong>{formatCount(item.count)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="analyticsEmpty">暂无数据</p>
      )}
      {page && totalPages && paginationParams ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          query=""
          basePath="/admin/analytics"
          extraParams={paginationParams}
          pageParam={pageParam}
          scrollTargetId={sectionId}
        />
      ) : null}
    </details>
  );
}

function SearchTagPanel({
  items,
  page,
  total,
  totalPages,
  paginationParams,
  detailParams,
}: {
  items: AnalyticsMetric[];
  page: number;
  total: number;
  totalPages: number;
  paginationParams: Record<string, string | undefined>;
  detailParams: Record<string, string | undefined>;
}) {
  return (
    <details className="analyticsMetricPanel analyticsSearchPanel" id="analytics-search-queries" open>
      <summary>
        <h3><Tags size={15} aria-hidden="true" />搜索热词</h3>
        <span>{formatCount(total)} 项</span>
      </summary>
      {items.length ? (
        <div className="analyticsSearchTags">
          {items.map((item) => {
            const query = new URLSearchParams({ q: item.label });
            Object.entries(detailParams).forEach(([key, value]) => {
              if (value) query.set(key, value);
            });
            return (
              <Link className="analyticsSearchTag" href={`/admin/analytics/search?${query.toString()}`} title={`查看“${item.label}”的搜索明细`} key={item.label}>
                <span>{item.label}</span>
                <strong>{formatCount(item.count)}</strong>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="analyticsEmpty">暂无搜索记录</p>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        query=""
        basePath="/admin/analytics"
        extraParams={paginationParams}
        pageParam="hotPage"
        scrollTargetId="analytics-search-queries"
      />
    </details>
  );
}

function PopularTagPanel({
  items,
  page,
  total,
  totalPages,
  paginationParams,
}: {
  items: AnalyticsMetric[];
  page: number;
  total: number;
  totalPages: number;
  paginationParams: Record<string, string | undefined>;
}) {
  return (
    <details className="analyticsMetricPanel analyticsSearchPanel" id="analytics-popular-tags" open>
      <summary>
        <h3><Tags size={15} aria-hidden="true" />热门标签</h3>
        <span>{formatCount(total)} 项</span>
      </summary>
      {items.length ? (
        <div className="analyticsSearchTags">
          {items.map((item) => (
            <span className="analyticsSearchTag" title={`${item.label}：${formatCount(item.count)} 次点击`} key={item.label}>
              <span>{item.label}</span>
              <strong>{formatCount(item.count)}</strong>
            </span>
          ))}
        </div>
      ) : (
        <p className="analyticsEmpty">暂无标签点击记录</p>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        query=""
        basePath="/admin/analytics"
        extraParams={paginationParams}
        pageParam="tagPage"
        scrollTargetId="analytics-popular-tags"
      />
    </details>
  );
}

function ReadingAnalyticsPanel({ analytics }: { analytics: ReadingAnalytics }) {
  const summary = [
    { label: "打开", value: analytics.opens },
    { label: "继续", value: analytics.resumes },
    { label: "读完", value: analytics.completions },
    { label: "平均进度", value: `${Math.round(analytics.averageProgress)}%` },
  ];
  return (
    <details className="analyticsMetricPanel analyticsReadingPanel" open>
      <summary>
        <h3><BookOpenText size={15} aria-hidden="true" />近 30 日阅读</h3>
        <span>聚合数据</span>
      </summary>
      <div className="analyticsReadingSummary">
        {summary.map((item) => (
          <span key={item.label}>
            <small>{item.label}</small>
            <strong>{typeof item.value === "number" ? formatCount(item.value) : item.value}</strong>
          </span>
        ))}
      </div>
      <div className="analyticsReadingColumns">
        <section>
          <h4>热门小说</h4>
          <div className="analyticsMetricList">
            {analytics.novels.length ? analytics.novels.map((item) => (
              <div className="analyticsMetricRow" key={`reading-novel-${item.id}`}>
                <span title={item.label}>{item.label}</span>
                <strong>{formatCount(item.opens)}</strong>
              </div>
            )) : <p className="analyticsEmpty">暂无数据</p>}
          </div>
        </section>
        <section>
          <h4>活跃读者</h4>
          <div className="analyticsMetricList">
            {analytics.users.length ? analytics.users.map((item) => (
              <div className="analyticsMetricRow" key={`reading-user-${item.id}`}>
                <span title={item.label}>{item.label}</span>
                <strong>{formatCount(item.opens)}</strong>
              </div>
            )) : <p className="analyticsEmpty">暂无数据</p>}
          </div>
        </section>
      </div>
    </details>
  );
}

export default async function AdminAnalyticsPage({ searchParams }: AdminAnalyticsPageProps) {
  const params = await searchParams;
  const realtimeLimit = getAnalyticsRealtimeLimit();
  const summary = getCachedAdminAnalyticsSummary(params.range, {
    searchQueryPage: params.hotPage,
    searchQueryPageSize: 100,
    contentPage: params.contentPage,
    contentPageSize: 50,
    tagPage: params.tagPage,
    tagPageSize: 50,
    customFrom: params.from,
    customTo: params.to,
  });
  const realtimeActivity = getAnalyticsRealtimeActivity(params.range, {
    realtimeLimit,
    realtimePage: params.page || params.realtimePage,
    realtimePageSize: 30,
    realtimeContentType: params.realtimeType,
    realtimeCountry: params.realtimeCountry,
    customFrom: params.from,
    customTo: params.to,
  });
  const realtimeCountries = getCachedAdminRealtimeCountries(params.range, {
    realtimeContentType: params.realtimeType,
    customFrom: params.from,
    customTo: params.to,
  });
  const overview = { ...summary, ...realtimeActivity, realtimeCountries };
  const enabled = isAnalyticsEnabled();
  const readingAnalytics = getCachedAdminReadingAnalytics(30, 10);
  const realtimeFilterParams = {
    realtimeType: overview.realtimeContentType === "all" ? undefined : overview.realtimeContentType,
    realtimeCountry: overview.realtimeCountry === "all" ? undefined : overview.realtimeCountry,
  };
  const paginationParams: Record<string, string | undefined> = {
    range: overview.range,
    from: overview.range === "custom" ? overview.customFrom : undefined,
    to: overview.range === "custom" ? overview.customTo : undefined,
    hotPage: overview.searchQueryPage > 1 ? String(overview.searchQueryPage) : undefined,
    contentPage: overview.contentPage > 1 ? String(overview.contentPage) : undefined,
    tagPage: overview.tagPage > 1 ? String(overview.tagPage) : undefined,
    ...realtimeFilterParams,
  };
  const searchPaginationParams: Record<string, string | undefined> = {
    range: overview.range,
    from: overview.range === "custom" ? overview.customFrom : undefined,
    to: overview.range === "custom" ? overview.customTo : undefined,
    page: overview.realtimePage > 1 ? String(overview.realtimePage) : undefined,
    contentPage: overview.contentPage > 1 ? String(overview.contentPage) : undefined,
    tagPage: overview.tagPage > 1 ? String(overview.tagPage) : undefined,
    ...realtimeFilterParams,
  };
  const contentPaginationParams: Record<string, string | undefined> = {
    range: overview.range,
    from: overview.range === "custom" ? overview.customFrom : undefined,
    to: overview.range === "custom" ? overview.customTo : undefined,
    page: overview.realtimePage > 1 ? String(overview.realtimePage) : undefined,
    hotPage: overview.searchQueryPage > 1 ? String(overview.searchQueryPage) : undefined,
    tagPage: overview.tagPage > 1 ? String(overview.tagPage) : undefined,
    ...realtimeFilterParams,
  };
  const tagPaginationParams: Record<string, string | undefined> = {
    range: overview.range,
    from: overview.range === "custom" ? overview.customFrom : undefined,
    to: overview.range === "custom" ? overview.customTo : undefined,
    page: overview.realtimePage > 1 ? String(overview.realtimePage) : undefined,
    hotPage: overview.searchQueryPage > 1 ? String(overview.searchQueryPage) : undefined,
    contentPage: overview.contentPage > 1 ? String(overview.contentPage) : undefined,
    ...realtimeFilterParams,
  };
  const realtimeResetSearch = new URLSearchParams({ range: overview.range });
  if (overview.range === "custom" && overview.customFrom) realtimeResetSearch.set("from", overview.customFrom);
  if (overview.range === "custom" && overview.customTo) realtimeResetSearch.set("to", overview.customTo);

  return (
    <AdminFrame active="analytics" notice={params.notice} tone={params.tone}>
      <section className="adminHome analyticsPage">
        <article className="adminPanel analyticsHeaderPanel">
          <div className="adminPanelHeader">
            <div>
              <h2>数据分析</h2>
              <p>{enabled ? "正在统计小说与资源访问、来源、地区和客户端。" : "统计功能已关闭，页面仅展示历史数据。"}</p>
            </div>
            <div className="analyticsControls">
              <div className="analyticsRangeTabs" aria-label="统计时间范围">
                {presetRanges.map((range) => (
                  <Link className={overview.range === range ? "isActive" : ""} href={`/admin/analytics?range=${range}`} key={range}>
                    {rangeLabels[range]}
                  </Link>
                ))}
              </div>
              <Form className={overview.range === "custom" ? "analyticsCustomRange isActive" : "analyticsCustomRange"} action="/admin/analytics">
                <input name="range" type="hidden" value="custom" />
                <label className="analyticsDateField">
                  <CalendarDays size={14} aria-hidden="true" />
                  <input aria-label="开始日期" defaultValue={overview.range === "custom" ? overview.customFrom || "" : ""} name="from" type="date" />
                </label>
                <span className="analyticsRangeDivider">至</span>
                <label className="analyticsDateField">
                  <input aria-label="结束日期" defaultValue={overview.range === "custom" ? overview.customTo || "" : ""} name="to" type="date" />
                </label>
                <button className="analyticsIconButton" type="submit" aria-label="查询自定义时间" title="查询自定义时间">
                  <Search size={15} aria-hidden="true" />
                </button>
                {overview.range === "custom" ? (
                  <Link className="analyticsIconButton" href="/admin/analytics?range=24h" aria-label="重置时间范围" title="重置时间范围">
                    <X size={15} aria-hidden="true" />
                  </Link>
                ) : null}
              </Form>
            </div>
          </div>
        </article>

        <div className="adminStats" aria-label="访问概览">
          <div className="adminStatCard">
            <MousePointerClick size={20} aria-hidden="true" />
            <span>内容访问</span>
            <strong>{formatCount(overview.totalViews)}</strong>
          </div>
          <div className="adminStatCard">
            <Globe2 size={20} aria-hidden="true" />
            <span>独立 IP</span>
            <strong>{formatCount(overview.uniqueIps)}</strong>
          </div>
          <div className="adminStatCard">
            <Radio size={20} aria-hidden="true" />
            <span>实时访问</span>
            <strong>{formatCount(overview.activeNow)}</strong>
          </div>
          <div className="adminStatCard">
            <Search size={20} aria-hidden="true" />
            <span>搜索次数</span>
            <strong>{formatCount(overview.totalSearches)}</strong>
          </div>
        </div>

        <div className="analyticsGrid">
          <SearchTagPanel
            items={overview.topSearchQueries}
            page={overview.searchQueryPage}
            total={overview.searchQueryTotal}
            totalPages={overview.searchQueryTotalPages}
            paginationParams={searchPaginationParams}
            detailParams={{
              range: overview.range,
              from: overview.range === "custom" ? overview.customFrom : undefined,
              to: overview.range === "custom" ? overview.customTo : undefined,
            }}
          />
          <MetricTable
            title="内容访问"
            items={overview.topContent}
            total={overview.contentTotal}
            page={overview.contentPage}
            totalPages={overview.contentTotalPages}
            paginationParams={contentPaginationParams}
            sectionId="analytics-content"
          />
          <PopularTagPanel
            items={overview.topTags}
            total={overview.tagTotal}
            page={overview.tagPage}
            totalPages={overview.tagTotalPages}
            paginationParams={tagPaginationParams}
          />
          <ReadingAnalyticsPanel analytics={readingAnalytics} />
          <MetricTable title="IP 地址" items={overview.topIps} />
          <MetricTable title="国家/地区" items={overview.topCountries} />
          <MetricTable title="来源网站" items={overview.topReferrers} />
          <MetricTable title="设备" items={overview.devices} />
          <MetricTable title="浏览器" items={overview.browsers} />
          <MetricTable title="操作系统" items={overview.operatingSystems} />
        </div>

        <section className="adminLoginAudit analyticsRealtime" id="realtime-activity">
          <div className="adminPanelHeader">
            <div>
              <h2>实时访问</h2>
              <p>
                共 {overview.realtimeTotal} 条，最多读取当前范围内最近 {realtimeLimit} 条。
              </p>
            </div>
            <MonitorSmartphone size={20} aria-hidden="true" />
          </div>
          <Form className="analyticsRealtimeFilters" action="/admin/analytics#realtime-activity">
            <input name="range" type="hidden" value={overview.range} />
            {overview.range === "custom" && overview.customFrom ? <input name="from" type="hidden" value={overview.customFrom} /> : null}
            {overview.range === "custom" && overview.customTo ? <input name="to" type="hidden" value={overview.customTo} /> : null}
            <AdminSelect name="realtimeType" defaultValue={overview.realtimeContentType} aria-label="按内容类型过滤">
              <option value="all">全部内容</option>
              <option value="novel">小说</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
              <option value="file">文件</option>
            </AdminSelect>
            <AdminSelect name="realtimeCountry" defaultValue={overview.realtimeCountry} aria-label="按国家或地区过滤">
              <option value="all">全部地区</option>
              {overview.realtimeCountries.map((country) => (
                <option value={country} key={country}>{prettyLabel(country)}</option>
              ))}
            </AdminSelect>
            <button className="adminIconTextButton" type="submit">
              <ListFilter size={15} aria-hidden="true" />
              筛选
            </button>
            {overview.realtimeContentType !== "all" || overview.realtimeCountry !== "all" ? (
              <Link
                className="adminTableIconButton"
                href={`/admin/analytics?${realtimeResetSearch.toString()}#realtime-activity`}
                aria-label="清除实时访问筛选"
                title="清除筛选"
              >
                <X size={15} aria-hidden="true" />
              </Link>
            ) : null}
          </Form>
          <div className="adminTableWrap">
            <table className="adminTable analyticsRealtimeTable">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>内容</th>
                  <th>来源</th>
                  <th>IP</th>
                  <th>地区</th>
                  <th>客户端</th>
                </tr>
              </thead>
              <tbody>
                {overview.realtime.length ? (
                  overview.realtime.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <LocalDateTime value={event.createdAt} />
                      </td>
                      <td>{prettyLabel(event.contentType)}</td>
                      <td title={event.contentTitle}>{event.contentTitle}</td>
                      <td title={event.referrer}>{prettyLabel(event.referrer)}</td>
                      <td title={event.ip}>{event.ip}</td>
                      <td>{prettyLabel(event.country)}</td>
                      <td title={`${event.device} / ${event.browser} / ${event.os}`}>
                        {prettyLabel(event.device)} / {prettyLabel(event.browser)} / {prettyLabel(event.os)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>暂无内容访问记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={overview.realtimePage}
            totalPages={overview.realtimeTotalPages}
            query=""
            basePath="/admin/analytics"
            extraParams={paginationParams}
            scrollTargetId="realtime-activity"
          />
        </section>
      </section>
    </AdminFrame>
  );
}
