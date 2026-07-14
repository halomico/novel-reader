import { Clock, KeyRound, Settings, Trash2, Upload, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { LocalDateTime } from "@/components/LocalDateTime";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, getUserAvatarMaxBytes, shouldNoticeStayVisibleAfterBlur } from "@/lib/config";
import { getCurrentUser } from "@/lib/user-auth";
import { listBrowseHistory } from "@/lib/users";
import {
  clearHistoryAction,
  deleteHistoryItemAction,
  updateAccountDisplayNameAction,
  updateAccountPasswordAction,
  updateHistoryVisibilityAction,
  uploadAvatarAction,
} from "./actions";

export const dynamic = "force-dynamic";

type AccountPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const history = user.historyVisible ? listBrowseHistory(user.id, { includeHidden: false }) : [];
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
        <input className="accountTabInput" id="account-tab-profile" name="accountTab" type="radio" defaultChecked />
        <input className="accountTabInput" id="account-tab-security" name="accountTab" type="radio" />
        <input className="accountTabInput" id="account-tab-history" name="accountTab" type="radio" />
        <aside className="accountSideNav" aria-label="账户导航">
          <label htmlFor="account-tab-profile">
            <UserRound size={16} aria-hidden="true" />
            账户资料
          </label>
          <label htmlFor="account-tab-security">
            <KeyRound size={16} aria-hidden="true" />
            账户安全
          </label>
          <label htmlFor="account-tab-history">
            <Clock size={16} aria-hidden="true" />
            浏览记录
          </label>
          <Link href="/settings">
            <Settings size={16} aria-hidden="true" />
            阅读设置
          </Link>
        </aside>

        <div className="accountContent">
          <article className="userPanel accountPanel accountProfile" id="profile">
            <div className="accountProfileHeader">
              <div className="accountAvatar" aria-hidden="true">
                {user.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={34} />}
              </div>
              <div>
                <h1>{user.displayName}</h1>
                <p>@{user.username}</p>
              </div>
            </div>

            <form className="accountProfileForm" action={updateAccountDisplayNameAction}>
              <label>
                <span>显示名称</span>
                <input name="displayName" defaultValue={user.displayName} maxLength={40} required />
              </label>
              <button type="submit">保存显示名称</button>
            </form>

            <form className="avatarUploadForm" action={uploadAvatarAction}>
              <label>
                <Upload size={17} aria-hidden="true" />
                <span>上传头像</span>
                <input name="avatar" type="file" accept="image/png,image/jpeg,image/pjpeg,image/webp,image/gif,.jpg,.jpeg,.jpe,.png,.webp,.gif" required />
              </label>
              <small>最大 {maxAvatarMb} MB</small>
              <button type="submit">更新头像</button>
            </form>
          </article>

          <article className="userPanel accountPanel accountSecurity" id="security">
            <div className="userPanelHeader">
              <KeyRound size={20} aria-hidden="true" />
              <div>
                <h2>账户安全</h2>
                <p>修改密码后，新密码会立即用于后续登录。</p>
              </div>
            </div>
            <form className="accountPasswordForm" action={updateAccountPasswordAction}>
              <label>
                <span>当前密码</span>
                <input name="currentPassword" type="password" autoComplete="current-password" required />
              </label>
              <label>
                <span>新密码</span>
                <input name="newPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required />
              </label>
              <label>
                <span>确认新密码</span>
                <input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={72} required />
              </label>
              <button type="submit">更新密码</button>
            </form>
          </article>

          <article className="userPanel accountPanel accountHistory" id="history">
            <div className="userPanelHeader accountHistoryHeader">
              <div className="accountHistoryHeading">
                <Clock size={20} aria-hidden="true" />
                <div>
                  <h2>浏览记录</h2>
                  <p>小说与资源访问，最多显示最近 200 条。</p>
                </div>
              </div>
              <form className="accountHistoryVisibility" action={updateHistoryVisibilityAction} aria-label="浏览记录显示设置">
                <button className={user.historyVisible ? "isActive" : ""} name="historyVisible" value="on" type="submit">显示</button>
                <button className={!user.historyVisible ? "isActive" : ""} name="historyVisible" value="off" type="submit">隐藏</button>
              </form>
            </div>

            {!user.historyVisible ? (
              <p className="emptyAccountText">浏览记录已隐藏，重新开启后可继续查看；历史数据仍会保留。</p>
            ) : history.length ? (
              <>
                <form action={deleteHistoryItemAction}>
                  <div className="adminTableWrap">
                    <table className="adminTable accountHistoryTable">
                      <thead>
                        <tr>
                          <th>选择</th>
                          <th>类型</th>
                          <th>内容</th>
                          <th>最近访问</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((item) => {
                          const href = item.source === "novel"
                            ? `/books/${item.itemId}?hit=${item.segmentIndex}#seg-${item.segmentIndex}`
                            : `/media/${item.itemId}`;
                          const typeLabel = item.source === "novel" ? "小说" : item.source === "video" ? "视频" : item.source === "audio" ? "音频" : "文件";
                          return (
                          <tr key={item.key}>
                            <td>
                              <input className="adminCheckbox" name="historyIds" type="checkbox" value={item.key} aria-label={`选择 ${item.title}`} />
                            </td>
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
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="accountHistoryActions">
                    <button className="secondaryUserButton" type="submit">
                      <Trash2 size={16} aria-hidden="true" />
                      隐藏所选
                    </button>
                    <button className="secondaryUserButton" type="submit" formAction={clearHistoryAction}>
                      <Trash2 size={16} aria-hidden="true" />
                      隐藏全部
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
