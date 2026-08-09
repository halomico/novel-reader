import type { Metadata } from "next";
import { Clock, KeyRound, MessageCircle, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/LocalDateTime";
import { AdminUserEntitlementPanel } from "@/components/AdminUserEntitlementPanel";
import { Pagination } from "@/components/Pagination";
import { listUserEntitlementsPage } from "@/lib/entitlements";
import { getUserById, listBrowseHistoryPage, listUserLoginRecordPage } from "@/lib/users";
import { clearAdminUserHistoryAction, deleteAdminUserHistoryAction } from "../../actions";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminUserDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    returnPath?: string;
    loginPage?: string;
    historyPage?: string;
    rightsPage?: string;
    view?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

function safeReturnPath(value: string | undefined): string {
  return value && (value === "/admin/users" || value.startsWith("/admin/users?")) && !/[\r\n#\\]/.test(value)
    ? value
    : "/admin/users";
}

export default async function AdminUserDetailPage({ params, searchParams }: AdminUserDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId < 1) {
    notFound();
  }

  const user = getUserById(userId);
  if (!user) {
    notFound();
  }

  const view = query.view === "rights" || query.view === "login" || query.view === "history" ? query.view : "overview";
  const history = view === "history"
    ? listBrowseHistoryPage(user.id, { page: Number(query.historyPage || 1), pageSize: 20 })
    : null;
  const loginRecords = view === "login"
    ? listUserLoginRecordPage(user.id, { page: Number(query.loginPage || 1), pageSize: 20 })
    : null;
  const entitlements = view === "rights"
    ? listUserEntitlementsPage(user.id, { page: Number(query.rightsPage || 1), pageSize: 20 })
    : null;
  const returnPath = safeReturnPath(query.returnPath);
  const detailBasePath = `/admin/users/${user.id}`;
  const detailParams = new URLSearchParams();
  if (returnPath !== "/admin/users") detailParams.set("returnPath", returnPath);
  if (view !== "overview") detailParams.set("view", view);
  if (loginRecords && loginRecords.page > 1) detailParams.set("loginPage", String(loginRecords.page));
  if (history && history.page > 1) detailParams.set("historyPage", String(history.page));
  if (entitlements && entitlements.page > 1) detailParams.set("rightsPage", String(entitlements.page));
  const detailReturnPath = `${detailBasePath}${detailParams.size ? `?${detailParams.toString()}` : ""}`;

  return (
    <AdminFrame active="users" notice={query.notice} tone={query.tone} breadcrumbs={[{ label: "用户管理", href: returnPath }, { label: user.displayName }]}>
      <section className="adminHome adminUserDetailPage">
        <article className="adminPanel">
          <div className="adminPanelHeader">
            <div>
              <h2>{user.displayName}</h2>
              <p>@{user.username}</p>
            </div>
            <span className="adminPanelHeaderActions">
              <Link className="adminTableIconButton" href={`/admin/station?compose=${encodeURIComponent(user.username)}`} title="发起站务对话" aria-label="发起站务对话">
                <MessageCircle size={16} aria-hidden="true" />
              </Link>
              <UserRound size={20} aria-hidden="true" />
            </span>
          </div>
          <div className="adminUserDetailGrid">
            <p>
              <strong>状态</strong>
              <span>{user.status === "active" ? "启用" : user.status === "pending" ? "待验证" : "停用"}</span>
            </p>
            <p>
              <strong>权限组</strong>
              <span>{user.role === "admin" ? "前台管理员" : "普通用户"}</span>
            </p>
            <p>
              <strong>成长</strong>
              <span>Lv.{user.trustLevel} · 苏打 {user.sodaBalance} · 曲奇 {user.cookieBalance}</span>
            </p>
            <p>
              <strong>注册时间</strong>
              <span>
                <LocalDateTime value={user.createdAt} />
              </span>
            </p>
            <p>
              <strong>注册 IP</strong>
              <span title={user.registrationIp || ""}>{user.registrationIp || "-"}</span>
            </p>
            <p>
              <strong>最后登录</strong>
              <span>
                <LocalDateTime value={user.lastLoginAt} />
              </span>
            </p>
            <p>
              <strong>最后登录 IP</strong>
              <span title={user.lastLoginIp || ""}>{user.lastLoginIp || "-"}</span>
            </p>
          </div>
        </article>

        <nav className="adminUserDetailTabs" aria-label="用户详情">
          {[
            ["overview", "概览"],
            ["rights", "权益"],
            ["login", "登录"],
            ["history", "最近"],
          ].map(([key, label]) => {
            const params = new URLSearchParams();
            if (key !== "overview") params.set("view", key);
            if (returnPath !== "/admin/users") params.set("returnPath", returnPath);
            return <Link className={view === key ? "isActive" : ""} href={`${detailBasePath}${params.size ? `?${params.toString()}` : ""}`} key={key}>{label}</Link>;
          })}
        </nav>

        {view === "overview" ? (
          <section className="adminUserOverviewNote">
            <strong>账户结构</strong>
            <p>等级控制平台能力，权益控制具体资源；登录与最近内容分别保留独立记录。</p>
          </section>
        ) : null}

        {view === "rights" && entitlements ? (
          <AdminUserEntitlementPanel userId={user.id} entitlements={entitlements} returnPath={returnPath === "/admin/users" ? undefined : returnPath} />
        ) : null}

        {view === "login" && loginRecords ? <section className="adminLoginAudit">
          <div className="adminPanelHeader">
            <div>
              <h2>登录记录</h2>
              <p>记录用户登录时的 IP 和 UA，共 {loginRecords.totalItems} 条。</p>
            </div>
            <KeyRound size={20} aria-hidden="true" />
          </div>
          <div className="adminTableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>IP</th>
                  <th>UA</th>
                </tr>
              </thead>
              <tbody>
                {loginRecords.items.length ? (
                  loginRecords.items.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <LocalDateTime value={record.loggedAt} />
                      </td>
                      <td title={record.ip}>{record.ip}</td>
                      <td title={record.userAgent}>{record.userAgent || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>暂无登录记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={loginRecords.page}
            totalPages={loginRecords.totalPages}
            query=""
            basePath={detailBasePath}
            pageParam="loginPage"
            extraParams={{
              view: "login",
              returnPath: returnPath === "/admin/users" ? undefined : returnPath,
            }}
          />
        </section> : null}

        {view === "history" && history ? <section className="adminLoginAudit">
          <div className="adminPanelHeader">
            <div>
              <h2>最近内容</h2>
              <p>用户的继续阅读与最近访问状态，共 {history.totalItems} 条；分析统计独立聚合。</p>
            </div>
            <Clock size={20} aria-hidden="true" />
          </div>
          <form action={deleteAdminUserHistoryAction}>
            <input name="userId" type="hidden" value={user.id} />
            <input name="returnPath" type="hidden" value={detailReturnPath} />
            <div className="adminTableWrap">
              <table className="adminTable adminUserHistoryTable">
                <thead>
                  <tr>
                    <th aria-label="选择记录">选择</th>
                    <th>类型</th>
                    <th>内容</th>
                    <th>最近访问</th>
                    <th>次数</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.length ? (
                    history.items.map((item) => {
                      const href = item.source === "novel"
                        ? `/books/${item.itemId}?hit=${item.segmentIndex}#seg-${item.segmentIndex}`
                        : `/media/${item.itemId}`;
                      const typeLabel = item.source === "novel" ? "小说" : item.source === "video" ? "视频" : item.source === "audio" ? "音频" : "文件";
                      return (
                      <tr key={item.key}>
                        <td className="adminUserHistorySelect"><input className="adminCheckbox" name="historyIds" type="checkbox" value={item.key} aria-label={`选择 ${item.title}`} /></td>
                        <td className="adminUserHistoryKind"><span className={`accountHistoryKind is-${item.source}`}>{typeLabel}</span></td>
                        <td className="adminUserHistoryContent">
                          {item.itemExists ? (
                            <Link href={href}>{item.title}</Link>
                          ) : (
                            <strong>{item.title}</strong>
                          )}
                        </td>
                        <td className="adminUserHistoryTime">
                          <LocalDateTime value={item.lastAccessedAt} />
                        </td>
                        <td className="adminUserHistoryCount">{item.visitCount}</td>
                      </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5}>暂无浏览记录。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {history.items.length ? (
              <div className="adminTableFooter">
                <button className="adminDangerButton" type="submit"><Trash2 size={16} aria-hidden="true" />删除所选</button>
                <button className="adminDangerButton" type="submit" formAction={clearAdminUserHistoryAction}><Trash2 size={16} aria-hidden="true" />清空全部</button>
              </div>
            ) : null}
          </form>
          <Pagination
            page={history.page}
            totalPages={history.totalPages}
            query=""
            basePath={detailBasePath}
            pageParam="historyPage"
            extraParams={{
              view: "history",
              returnPath: returnPath === "/admin/users" ? undefined : returnPath,
            }}
          />
        </section> : null}
      </section>
    </AdminFrame>
  );
}
