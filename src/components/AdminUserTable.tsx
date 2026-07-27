"use client";

import { Pencil, Save, Trash2, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { deleteAdminUsersAction, updateAdminUserAction, updateAdminUserStatusAction } from "@/app/admin/actions";
import { LocalDateTime } from "@/components/LocalDateTime";
import { AdminSelect } from "@/components/AdminSelect";
import { usePersistentSelection } from "@/components/usePersistentSelection";
import { InlineMutationNotice, useInlineMutation } from "@/components/useInlineMutation";
import type { UserProfile } from "@/lib/users";

export function AdminUserTable({ users, returnPath }: { users: UserProfile[]; returnPath: string }) {
  const mutation = useInlineMutation();
  const { selectedIds, toggleOne, togglePage, clearSelection } = usePersistentSelection("novel-reader-admin-user-selection");
  const [visibleUsers, setVisibleUsers] = useState(users);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const visibleIds = visibleUsers.map((user) => user.id);
  const isAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  useEffect(() => {
    setVisibleUsers(users);
    setEditingUser(null);
  }, [users]);

  function toggleAll() {
    togglePage(visibleIds);
  }

  function mergeUser(user: UserProfile) {
    setVisibleUsers((current) => current.map((item) => item.id === user.id ? user : item));
  }

  function updateStatus(form: HTMLFormElement, user: UserProfile, status: UserProfile["status"]) {
    const formData = new FormData(form);
    formData.set("status", status);
    mergeUser({ ...user, status });
    mutation.run(
      () => updateAdminUserStatusAction(formData),
      (result) => {
        if (result.data?.user) mergeUser(result.data.user);
        else if (!result.ok) mergeUser(user);
      },
    );
  }

  function updateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => updateAdminUserAction(formData),
      (result) => {
        if (result.data?.user) mergeUser(result.data.user);
        if (result.ok) setEditingUser(null);
      },
    );
  }

  function deleteUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIds.length || !window.confirm(`确认删除所选 ${selectedIds.length} 个用户？`)) return;
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => deleteAdminUsersAction(formData),
      (result) => {
        const deletedIds = result.data?.deletedIds || [];
        if (!deletedIds.length) return;
        const deleted = new Set(deletedIds);
        setVisibleUsers((current) => current.filter((user) => !deleted.has(user.id)));
        clearSelection();
      },
    );
  }

  return (
    <>
      <InlineMutationNotice notice={mutation.notice} />
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
            {visibleUsers.length ? (
              visibleUsers.map((user) => (
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
                      <small>
                        {user.displayName}
                        {user.role === "admin" ? " · 前台管理员" : ""}
                        {" · "}Lv.{user.trustLevel} · 苏打 {user.sodaBalance}
                      </small>
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
                    <form className="adminUserStatusForm" onSubmit={(event) => event.preventDefault()}>
                      <input name="userId" type="hidden" value={user.id} />
                      <input name="returnPath" type="hidden" value={returnPath} />
                      <AdminSelect
                        className={`adminUserStatusSelect is-${user.status}`}
                        name="status"
                        value={user.status}
                        key={user.status}
                        disabled={mutation.pending}
                        onChange={(event) => {
                          const form = event.currentTarget.form;
                          if (!form) return;
                          updateStatus(form, user, event.currentTarget.value as UserProfile["status"]);
                        }}
                        aria-label={`${user.username} 状态`}
                      >
                        <option value="active">启用</option>
                        <option value="disabled">停用</option>
                      </AdminSelect>
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
          <form onSubmit={deleteUsers}>
            <input name="returnPath" type="hidden" value={returnPath} />
            {selectedIds.map((id) => (
              <input name="userIds" type="hidden" value={id} key={id} />
            ))}
            <button className="adminDangerButton" type="submit" disabled={selectedIds.length === 0 || mutation.pending}>
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
          <form className="adminMediaEditDialog adminUserEditDialog" onSubmit={updateUser} role="dialog" aria-modal="true" aria-labelledby="admin-user-edit-title" key={editingUser.id}>
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
              <span>权限组</span>
              <AdminSelect name="role" defaultValue={editingUser.role}>
                <option value="user">普通用户</option>
                <option value="admin">前台管理员</option>
              </AdminSelect>
            </label>
            <div className="adminUserGrowthFields">
              <label>
                <span>苏打余额</span>
                <input name="sodaBalance" type="number" min="0" max="1000000000" defaultValue={editingUser.sodaBalance} />
              </label>
              <label>
                <span>累计苏打</span>
                <input name="sodaExperience" type="number" min="0" max="1000000000" defaultValue={editingUser.sodaExperience} />
              </label>
            </div>
            <label>
              <span>重置密码</span>
              <input name="newPassword" type="password" minLength={6} maxLength={72} placeholder="留空则不修改" />
            </label>
            <footer>
              <button className="adminSecondaryButton" type="button" onClick={() => setEditingUser(null)}>取消</button>
              <button type="submit" disabled={mutation.pending}><Save size={16} aria-hidden="true" />保存</button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
