import type { Metadata } from "next";
import { CalendarDays, Globe2, MonitorSmartphone, MousePointerClick, Radio, Search, Tags, X } from "lucide-react";
import Link from "next/link";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Pagination } from "@/components/Pagination";
import { getAnalyticsOverview, type AnalyticsMetric } from "@/lib/analytics";
import { getAnalyticsRealtimeLimit, isAnalyticsEnabled } from "@/lib/config";
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

function MetricTable({ title, items }: { title: string; items: AnalyticsMetric[] }) {
  return (
    <details className="analyticsMetricPanel" open>
      <summary>
        <h3>{title}</h3>
        <span>{items.length} 项</span>
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
    </details>
  );
}

function SearchTagPanel({ items }: { items: AnalyticsMetric[] }) {
  return (
    <details className="analyticsMetricPanel analyticsSearchPanel" open>
      <summary>
        <h3><Tags size={15} aria-hidden="true" />搜索热词</h3>
        <span>{items.length} 项</span>
      </summary>
      {items.length ? (
        <div className="analyticsSearchTags">
          {items.map((item) => (
            <span className="analyticsSearchTag" title={`${item.label} · ${formatCount(item.count)} 次`} key={item.label}>
              <span>{item.label}</span>
              <strong>{formatCount(item.count)}</strong>
            </span>
          ))}
        </div>
      ) : (
        <p className="analyticsEmpty">暂无搜索记录</p>
      )}
    </details>
  );
}

export default async function AdminAnalyticsPage({ searchParams }: AdminAnalyticsPageProps) {
  const params = await searchParams;
  const realtimeLimit = getAnalyticsRealtimeLimit();
  const overview = getAnalyticsOverview(params.range, {
    realtimeLimit,
    realtimePage: params.page || params.realtimePage,
    realtimePageSize: 30,
    customFrom: params.from,
    customTo: params.to,
  });
  const enabled = isAnalyticsEnabled();
  const paginationParams: Record<string, string | undefined> = {
    range: overview.range,
    from: overview.range === "custom" ? overview.customFrom : undefined,
    to: overview.range === "custom" ? overview.customTo : undefined,
  };

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
              <form className={overview.range === "custom" ? "analyticsCustomRange isActive" : "analyticsCustomRange"} action="/admin/analytics">
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
              </form>
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
          <SearchTagPanel items={overview.topSearchQueries} />
          <MetricTable title="内容访问" items={overview.topContent} />
          <MetricTable title="IP 地址" items={overview.topIps} />
          <MetricTable title="国家/地区" items={overview.topCountries} />
          <MetricTable title="来源网站" items={overview.topReferrers} />
          <MetricTable title="设备" items={overview.devices} />
          <MetricTable title="浏览器" items={overview.browsers} />
          <MetricTable title="操作系统" items={overview.operatingSystems} />
        </div>

        <section className="adminLoginAudit analyticsRealtime">
          <div className="adminPanelHeader">
            <div>
              <h2>实时访问</h2>
              <p>
                当前范围 {overview.realtimeTotal} / {realtimeLimit} 条内容访问记录，每页 {overview.realtimePageSize} 条。
              </p>
            </div>
            <MonitorSmartphone size={20} aria-hidden="true" />
          </div>
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
          <Pagination page={overview.realtimePage} totalPages={overview.realtimeTotalPages} query="" basePath="/admin/analytics" extraParams={paginationParams} />
        </section>
      </section>
    </AdminFrame>
  );
}
