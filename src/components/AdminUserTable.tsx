"use client";

import { Pencil, Save, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteAdminUsersAction, updateAdminUserAction, updateAdminUserStatusAction } from "@/app/admin/actions";
import { LocalDateTime } from "@/components/LocalDateTime";
import { usePersistentSelection } from "@/components/usePersistentSelection";
import type { UserProfile } from "@/lib/users";

export function AdminUserTable({ users, returnPath }: { users: UserProfile[]; returnPath: string }) {
  const { selectedIds, toggleOne, togglePage, clearSelection } = usePersistentSelection("novel-reader-admin-user-selection");
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const visibleIds = users.map((user) => user.id);
  const isAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  useEffect(() => {
    setEditingUser(null);
  }, [users]);

  function toggleAll() {
    togglePage(visibleIds);
  }

  return (
    <>
      <div className="adminTableWrap">
        <table className="adminTable adminUserTable">
          <thead>
            <tr>
              <th aria-label="选择用户">
                <input className="adminCheckbox" type="checkbox" checked={isAllSelected} disabled={!visibleIds.length} onChange={toggleAll} />
              </th>
              <th>用户</th>
              <th>注册信息</th>
              <th>最近登录</th>
              <th>编辑</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {users.length ? (
              users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <input
                      className="adminCheckbox"
                      type="checkbox"
                      checked={selectedIds.includes(user.id)}
                      onChange={() => toggleOne(user.id)}
                      aria-label={`选择 ${user.username}`}
                    />
                  </td>
                  <td>
                    <span className="adminUserIdentity">
                      <Link className="adminUserNameLink" href={`/admin/users/${user.id}?returnPath=${encodeURIComponent(returnPath)}`}>
                        {user.username}
                      </Link>
                      <small>{user.displayName}</small>
                    </span>
                  </td>
                  <td>
                    <span className="adminUserMeta">
                      <LocalDateTime value={user.createdAt} />
                      <small title={user.registrationIp || ""}>{user.registrationIp || "IP 未记录"}</small>
                    </span>
                  </td>
                  <td>
                    <span className="adminUserMeta">
                      <LocalDateTime value={user.lastLoginAt} />
                      <small title={user.lastLoginIp || ""}>{user.lastLoginIp || "IP 未记录"}</small>
                    </span>
                  </td>
                  <td>
                    <button
                      className="adminTableIconButton"
                      type="button"
                      onClick={() => setEditingUser(user)}
                      aria-label={`编辑 ${user.username}`}
                      title="编辑用户"
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                  </td>
                  <td>
                    <form className="adminUserStatusForm" action={updateAdminUserStatusAction}>
                      <input name="userId" type="hidden" value={user.id} />
                      <input name="returnPath" type="hidden" value={returnPath} />
                      <select
                        className={`adminUserStatusSelect is-${user.status}`}
                        name="status"
                        defaultValue={user.status}
                        key={user.status}
                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                        aria-label={`${user.username} 状态`}
                      >
                        <option value="active">启用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </form>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>未找到用户。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="adminTableFooter adminUserTableFooter">
        <div className="adminBulkActionRow">
          {selectedIds.length ? (
            <button className="adminTableIconButton" type="button" onClick={clearSelection} aria-label="清除全部选择" title="清除选择">
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
          <form action={deleteAdminUsersAction} onSubmit={clearSelection}>
            <input name="returnPath" type="hidden" value={returnPath} />
            {selectedIds.map((id) => (
              <input name="userIds" type="hidden" value={id} key={id} />
            ))}
            <button className="adminDangerButton" type="submit" disabled={selectedIds.length === 0}>
              <Trash2 size={16} aria-hidden="true" />
              删除所选{selectedIds.length ? ` (${selectedIds.length})` : ""}
            </button>
          </form>
        </div>
      </div>

      {editingUser ? (
        <div
          className="adminMediaEditBackdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setEditingUser(null)}
        >
          <form className="adminMediaEditDialog adminUserEditDialog" action={updateAdminUserAction} role="dialog" aria-modal="true" aria-labelledby="admin-user-edit-title">
            <header>
              <div>
                <h3 id="admin-user-edit-title">编辑用户</h3>
                <p>{editingUser.username}</p>
              </div>
              <button type="button" onClick={() => setEditingUser(null)} aria-label="关闭编辑" title="关闭">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <input name="userId" type="hidden" value={editingUser.id} />
            <input name="status" type="hidden" value={editingUser.status} />
            <input name="returnPath" type="hidden" value={returnPath} />
            <label>
              <span>显示名称</span>
              <input name="displayName" defaultValue={editingUser.displayName} maxLength={40} required autoFocus />
            </label>
            <label>
              <span>搜索限速（次/分钟）</span>
              <input
                name="searchRateLimitPerMinute"
                type="number"
                min="1"
                max="600"
                defaultValue={editingUser.searchRateLimitPerMinute ?? ""}
                placeholder="跟随系统全局值"
              />
            </label>
            <label>
              <span>重置密码</span>
              <input name="newPassword" type="password" minLength={6} maxLength={72} placeholder="留空则不修改" />
            </label>
            <footer>
              <button className="adminSecondaryButton" type="button" onClick={() => setEditingUser(null)}>取消</button>
              <button type="submit"><Save size={16} aria-hidden="true" />保存</button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
