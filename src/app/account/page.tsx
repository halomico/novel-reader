import { Clock, Trash2, Upload, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, getUserAvatarMaxBytes, shouldNoticeStayVisibleAfterBlur } from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { listReadingHistory } from "@/lib/users";
import { clearHistoryAction, deleteHistoryItemAction, uploadAvatarAction } from "./actions";

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const history = listReadingHistory(user.id);
  const maxAvatarMb = (getUserAvatarMaxBytes() / 1024 / 1024).toFixed(1);
  const noticeDisplaySeconds = getNoticeDisplaySeconds();
  const noticeStayVisibleAfterBlur = shouldNoticeStayVisibleAfterBlur();

  return (
    <main className="appShell">
      <SiteHeader />
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={noticeDisplaySeconds}
          stayVisibleAfterBlur={noticeStayVisibleAfterBlur}
        />
      ) : null}

      <section className="accountLayout">
        <aside className="accountSideNav" aria-label="账户导航">
          <a href="#profile">
            <UserRound size={16} aria-hidden="true" />
            账户资料
          </a>
          <a href="#history">
            <Clock size={16} aria-hidden="true" />
            浏览记录
          </a>
        </aside>

        <div className="accountContent">
          <article className="userPanel accountProfile" id="profile">
            <div className="accountProfileHeader">
              <div className="accountAvatar" aria-hidden="true">
                {user.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={34} />}
              </div>
              <div>
                <h1>{user.displayName}</h1>
                <p>@{user.username}</p>
                <p>上次登录：{formatDate(user.lastLoginAt)}</p>
                <p>登录 IP：{user.lastLoginIp || "-"}</p>
              </div>
            </div>

            <form className="avatarUploadForm" action={uploadAvatarAction}>
              <label>
                <Upload size={17} aria-hidden="true" />
                <span>上传头像</span>
                <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
              </label>
              <small>最大 {maxAvatarMb} MB</small>
              <button type="submit">更新头像</button>
            </form>
          </article>

          <article className="userPanel accountHistory" id="history">
            <div className="userPanelHeader">
              <Clock size={20} aria-hidden="true" />
              <div>
                <h2>浏览记录</h2>
                <p>最多显示最近 200 条，可多选删除或清空。</p>
              </div>
            </div>

            {history.length ? (
              <>
                <form action={deleteHistoryItemAction}>
                  <div className="adminTableWrap">
                    <table className="adminTable accountHistoryTable">
                      <thead>
                        <tr>
                          <th>选择</th>
                          <th>书名</th>
                          <th>最近阅读</th>
                          <th>次数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <input className="adminCheckbox" name="historyIds" type="checkbox" value={item.id} aria-label={`选择 ${item.title}`} />
                            </td>
                            <td>
                              {item.novelExists ? (
                                <Link href={`/books/${item.novelId}?hit=${item.segmentIndex}#seg-${item.segmentIndex}`}>{item.title}</Link>
                              ) : (
                                <strong>{item.title}</strong>
                              )}
                            </td>
                            <td>{formatDate(item.lastReadAt)}</td>
                            <td>{item.visitCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="accountHistoryActions">
                    <button className="secondaryUserButton" type="submit">
                      <Trash2 size={16} aria-hidden="true" />
                      删除所选
                    </button>
                    <button className="secondaryUserButton" type="submit" formAction={clearHistoryAction}>
                      <Trash2 size={16} aria-hidden="true" />
                      清空全部
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <p className="emptyAccountText">暂无浏览记录。</p>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
