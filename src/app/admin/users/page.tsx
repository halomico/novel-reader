import { ChevronDown, Search, UserPlus, Users } from "lucide-react";
import type { Metadata } from "next";
import { Pagination } from "@/components/Pagination";
import { AdminUserTable } from "@/components/AdminUserTable";
import { listUsers } from "@/lib/users";
import { createAdminUserAction } from "../actions";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminUsersPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await searchParams;
  const userList = listUsers({
    page: Number(params.page || "1"),
    q: params.q || "",
    pageSize: 30,
  });
  const returnParams = new URLSearchParams({ page: String(userList.page) });
  if (userList.query) {
    returnParams.set("q", userList.query);
  }
  const returnPath = `/admin/users?${returnParams.toString()}`;

  return (
    <AdminFrame active="users" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminUserPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>用户管理</h2>
            <p>管理前台用户、头像资料、登录状态和单用户全文搜索限速。</p>
          </div>
          <form className="adminTitleSearchForm" action="/admin/users">
            <Search size={17} aria-hidden="true" />
            <input name="q" defaultValue={userList.query} placeholder="搜索用户名、昵称或 IP" />
            <button type="submit">搜索</button>
          </form>
        </div>

        <details className="adminCreateUserPanel">
          <summary>
            <span><UserPlus size={17} aria-hidden="true" />新增用户</span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <form className="adminCreateUserForm" action={createAdminUserAction}>
            <input name="returnPath" type="hidden" value={returnPath} />
            <label>
              <span>用户名</span>
              <input name="username" minLength={3} maxLength={32} required />
            </label>
            <label>
              <span>显示名称</span>
              <input name="displayName" maxLength={40} />
            </label>
            <label>
              <span>初始密码</span>
              <input name="password" type="password" minLength={6} maxLength={72} required />
            </label>
            <label>
              <span>初始状态</span>
              <select name="status" defaultValue="active">
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
            <label>
              <span>权限组</span>
              <select name="role" defaultValue="user">
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label>
              <span>搜索限速（次/分钟）</span>
              <input name="searchRateLimitPerMinute" type="number" min="1" max="600" placeholder="跟随全局" />
            </label>
            <button type="submit"><UserPlus size={15} aria-hidden="true" />创建用户</button>
          </form>
        </details>

        <div className="adminTableToolbar">
          <span>
            <Users size={15} aria-hidden="true" />
            共 {userList.totalUsers} 个用户
          </span>
        </div>

        <AdminUserTable users={userList.users} returnPath={returnPath} />
        <Pagination page={userList.page} totalPages={userList.totalPages} query={userList.query} basePath="/admin/users" />
      </article>
    </AdminFrame>
  );
}
