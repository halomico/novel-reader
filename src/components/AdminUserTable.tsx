"use client";

import { Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { deleteAdminUsersAction, updateAdminUserAction } from "@/app/admin/actions";
import { LocalDateTime } from "@/components/LocalDateTime";
import type { UserProfile } from "@/lib/users";

export function AdminUserTable({
  users,
  page,
  totalPages,
  totalUsers,
}: {
  users: UserProfile[];
  page: number;
  totalPages: number;
  totalUsers: number;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const visibleIds = users.map((user) => user.id);
  const isAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  function toggleAll() {
    setSelectedIds(isAllSelected ? [] : visibleIds);
  }

  function toggleOne(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
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
              <th>用户名</th>
              <th>显示名称</th>
              <th>状态</th>
              <th>搜索限速</th>
              <th>注册时间</th>
              <th>注册 IP</th>
              <th>最后登录</th>
              <th>登录 IP</th>
              <th>编辑</th>
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
                    <Link className="adminUserNameLink" href={`/admin/users/${user.id}`}>
                      {user.username}
                    </Link>
                  </td>
                  <td>{user.displayName}</td>
                  <td>{user.status === "active" ? "启用" : "停用"}</td>
                  <td>{user.searchRateLimitPerMinute || "全局"}</td>
                  <td>
                    <LocalDateTime value={user.createdAt} />
                  </td>
                  <td title={user.registrationIp || ""}>{user.registrationIp || "-"}</td>
                  <td>
                    <LocalDateTime value={user.lastLoginAt} />
                  </td>
                  <td title={user.lastLoginIp || ""}>{user.lastLoginIp || "-"}</td>
                  <td>
                    <form className="adminInlineEditForm" action={updateAdminUserAction}>
                      <input name="userId" type="hidden" value={user.id} />
                      <input name="displayName" defaultValue={user.displayName} aria-label="显示名称" />
                      <select className="adminStatusSelect" name="status" defaultValue={user.status} aria-label="状态">
                        <option value="active">启用</option>
                        <option value="disabled">停用</option>
                      </select>
                      <input
                        name="searchRateLimitPerMinute"
                        type="number"
                        min="1"
                        max="600"
                        defaultValue={user.searchRateLimitPerMinute ?? ""}
                        placeholder="全局限速"
                        aria-label="搜索限速"
                      />
                      <input name="newPassword" type="password" placeholder="新密码" aria-label="新密码" />
                      <button className="adminInlineSaveButton" type="submit" aria-label={`保存 ${user.username}`} title="保存">
                        <Save size={15} aria-hidden="true" />
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10}>未找到用户。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="adminTableFooter">
        <form action={deleteAdminUsersAction}>
          {selectedIds.map((id) => (
            <input name="userIds" type="hidden" value={id} key={id} />
          ))}
          <button className="adminDangerButton" type="submit" disabled={selectedIds.length === 0}>
            <Trash2 size={17} aria-hidden="true" />
            删除所选
          </button>
        </form>
        <span>
          第 {page} / {totalPages} 页，共 {totalUsers} 个用户
        </span>
      </div>
    </>
  );
}
