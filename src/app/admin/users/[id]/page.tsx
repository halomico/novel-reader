import type { Metadata } from "next";
import { ArrowLeft, Clock, KeyRound, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/LocalDateTime";
import { getUserById, listBrowseHistory, listUserLoginRecords } from "@/lib/users";
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

  const history = listBrowseHistory(user.id);
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
              <p>小说与资源访问，最多显示最近 200 条。</p>
            </div>
            <Clock size={20} aria-hidden="true" />
          </div>
          <div className="adminTableWrap">
            <table className="adminTable">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>内容</th>
                  <th>最近访问</th>
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {history.length ? (
                  history.map((item) => {
                    const href = item.source === "novel"
                      ? `/books/${item.itemId}?hit=${item.segmentIndex}#seg-${item.segmentIndex}`
                      : `/media/${item.itemId}`;
                    const typeLabel = item.source === "novel" ? "小说" : item.source === "video" ? "视频" : item.source === "audio" ? "音频" : "文件";
                    return (
                    <tr key={item.key}>
                      <td><span className={`accountHistoryKind is-${item.source}`}>{typeLabel}</span></td>
                      <td>
                        {item.itemExists ? (
                          <Link href={href}>{item.title}</Link>
                        ) : (
                          <strong>{item.title}</strong>
                        )}
                      </td>
                      <td>
                        <LocalDateTime value={item.lastAccessedAt} />
                      </td>
                      <td>{item.visitCount}</td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4}>暂无浏览记录。</td>
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
