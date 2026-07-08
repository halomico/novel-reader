import type { Metadata } from "next";
import { ArrowLeft, Clock, KeyRound, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/LocalDateTime";
import { getUserById, listReadingHistory, listUserLoginRecords } from "@/lib/users";
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
};

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId < 1) {
    notFound();
  }

  const user = getUserById(userId);
  if (!user) {
    notFound();
  }

  const history = listReadingHistory(user.id);
  const loginRecords = listUserLoginRecords(user.id);

  return (
    <AdminFrame active="users">
      <section className="adminHome adminUserDetailPage">
        <Link className="adminBackLink" href="/admin/users">
          <ArrowLeft size={16} aria-hidden="true" />
          返回用户管理
        </Link>

        <article className="adminPanel">
          <div className="adminPanelHeader">
            <div>
              <h2>{user.displayName}</h2>
              <p>@{user.username}</p>
            </div>
            <UserRound size={20} aria-hidden="true" />
          </div>
          <div className="adminUserDetailGrid">
            <p>
              <strong>状态</strong>
              <span>{user.status === "active" ? "启用" : "停用"}</span>
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
            <p>
              <strong>搜索限速</strong>
              <span>{user.searchRateLimitPerMinute || "全局"}</span>
            </p>
          </div>
        </article>

        <section className="adminLoginAudit">
          <div className="adminPanelHeader">
            <div>
              <h2>登录记录</h2>
              <p>记录用户登录时的 IP 和 UA。</p>
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
                {loginRecords.length ? (
                  loginRecords.map((record) => (
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
        </section>

        <section className="adminLoginAudit">
          <div className="adminPanelHeader">
            <div>
              <h2>浏览记录</h2>
              <p>来自前台阅读历史，最多显示最近 200 条。</p>
            </div>
            <Clock size={20} aria-hidden="true" />
          </div>
          <div className="adminTableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>书名</th>
                  <th>最近阅读</th>
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {history.length ? (
                  history.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.novelExists ? (
                          <Link href={`/books/${item.novelId}?hit=${item.segmentIndex}#seg-${item.segmentIndex}`}>{item.title}</Link>
                        ) : (
                          <strong>{item.title}</strong>
                        )}
                      </td>
                      <td>
                        <LocalDateTime value={item.lastReadAt} />
                      </td>
                      <td>{item.visitCount}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>暂无浏览记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </AdminFrame>
  );
}
