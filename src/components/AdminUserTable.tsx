"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteAdminUsersAction, updateAdminUserAction } from "@/app/admin/actions";
import type { UserProfile } from "@/lib/users";

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

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
                    <strong>{user.username}</strong>
                  </td>
                  <td>{user.displayName}</td>
                  <td>{user.status === "active" ? "启用" : "停用"}</td>
                  <td>{user.searchRateLimitPerMinute || "全局"}</td>
                  <td>{formatDate(user.lastLoginAt)}</td>
                  <td title={user.lastLoginIp || ""}>{user.lastLoginIp || "-"}</td>
                  <td>
                    <form className="adminInlineEditForm" action={updateAdminUserAction}>
                      <input name="userId" type="hidden" value={user.id} />
                      <input name="displayName" defaultValue={user.displayName} aria-label="显示名称" />
                      <select name="status" defaultValue={user.status} aria-label="状态">
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
                      <button type="submit">保存</button>
                    </form>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>未找到用户。</td>
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
