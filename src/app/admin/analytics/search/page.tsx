import { BookOpen, ListChecks, MousePointerClick, Search } from "lucide-react";
import type { Metadata } from "next";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Pagination } from "@/components/Pagination";
import { getSearchQueryDetails, normalizeSearchAnalyticsQuery, type SearchQuerySource } from "@/lib/analytics";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type SearchDetailPageProps = {
  searchParams: Promise<{
    q?: string;
    range?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
};

const SOURCE_LABELS: Record<SearchQuerySource, string> = {
  direct: "直接访问",
  header_title: "顶部书名搜索",
  header_content: "顶部正文搜索",
  reader_current: "正文页本文搜索",
  reader_hotword: "文末热词",
  advanced_tags: "高级搜索",
};

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

export default async function AdminSearchDetailPage({ searchParams }: SearchDetailPageProps) {
  const params = await searchParams;
  const query = normalizeSearchAnalyticsQuery(params.q || "");
  const details = getSearchQueryDetails(query, params.range, {
    page: params.page,
    pageSize: 30,
    customFrom: params.from,
    customTo: params.to,
  });
  const analyticsParams = new URLSearchParams();
  if (params.range) analyticsParams.set("range", params.range);
  if (params.from) analyticsParams.set("from", params.from);
  if (params.to) analyticsParams.set("to", params.to);
  const analyticsHref = `/admin/analytics${analyticsParams.size ? `?${analyticsParams.toString()}` : ""}`;

  return (
    <AdminFrame
      active="analytics"
      breadcrumbs={[
        { label: "数据分析", href: analyticsHref },
        { label: query || "搜索明细" },
      ]}
    >
      <section className="adminHome analyticsSearchDetailPage">
        <article className="adminPanel">
          <div className="adminPanelHeader">
            <div>
              <h2>{query || "搜索明细"}</h2>
              <p>{details?.terms.length ? `词项：${details.terms.join("、")}` : "查看每次搜索的来源、结果与后续点击。"}</p>
            </div>
            <Search size={20} aria-hidden="true" />
          </div>
          {details?.sources.length ? (
            <div className="analyticsSearchSources" aria-label="搜索来源">
              {details.sources.map((source) => (
                <span key={source.label}>{SOURCE_LABELS[source.label as SearchQuerySource] || source.label} <strong>{formatCount(source.count)}</strong></span>
              ))}
            </div>
          ) : null}
        </article>

        {details ? (
          <>
            <div className="adminStats" aria-label="搜索概览">
              <div className="adminStatCard"><Search size={20} aria-hidden="true" /><span>搜索次数</span><strong>{formatCount(details.totalSearches)}</strong></div>
              <div className="adminStatCard"><ListChecks size={20} aria-hidden="true" /><span>结果条数</span><strong>{formatCount(details.totalResults)}</strong></div>
              <div className="adminStatCard"><BookOpen size={20} aria-hidden="true" /><span>结果小说</span><strong>{formatCount(details.totalResultNovels)}</strong></div>
              <div className="adminStatCard"><MousePointerClick size={20} aria-hidden="true" /><span>结果点击</span><strong>{formatCount(details.totalClicks)}</strong></div>
            </div>

            <section className="adminLoginAudit analyticsSearchEvents">
              <div className="adminPanelHeader">
                <div>
                  <h2>搜索记录</h2>
                  <p>{details.clickedSearches} 次搜索产生了结果点击。</p>
                </div>
              </div>
              <div className="adminTableWrap">
                <table className="adminTable analyticsSearchEventsTable">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>入口</th>
                      <th>用户</th>
                      <th>结果</th>
                      <th>起始小说</th>
                      <th>后续点击</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.events.map((event) => (
                      <tr key={event.id}>
                        <td><LocalDateTime value={event.createdAt} /></td>
                        <td>{SOURCE_LABELS[event.source]} · {event.mode === "title" ? "书名" : "正文"}</td>
                        <td>{event.userLabel}</td>
                        <td>{event.resultCount === null ? "未记录" : `${formatCount(event.resultCount)} 条 / ${formatCount(event.resultNovelCount || 0)} 本`}</td>
                        <td title={event.originNovelTitle}>{event.originNovelTitle || "-"}</td>
                        <td title={event.lastClickedNovelTitle}>
                          {event.clickCount ? `${event.lastClickedNovelTitle} · ${formatCount(event.clickCount)} 次` : "未点击"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={details.page}
                totalPages={details.totalPages}
                query=""
                basePath="/admin/analytics/search"
                extraParams={{ q: details.query, range: params.range, from: params.from, to: params.to }}
              />
            </section>
          </>
        ) : (
          <section className="adminPanel analyticsEmpty">暂无这个搜索词的记录。</section>
        )}
      </section>
    </AdminFrame>
  );
}
