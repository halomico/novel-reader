import { Search, UserPlus, Users } from "lucide-react";
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

        <form className="adminCreateUserForm" action={createAdminUserAction}>
          <div className="adminCreateUserTitle">
            <UserPlus size={18} aria-hidden="true" />
            <strong>新增用户</strong>
          </div>
          <input name="username" placeholder="用户名" minLength={3} maxLength={32} required />
          <input name="displayName" placeholder="显示名称" maxLength={40} />
          <input name="password" type="password" placeholder="初始密码" minLength={6} maxLength={72} required />
          <select name="status" defaultValue="active" aria-label="状态">
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
          <input name="searchRateLimitPerMinute" type="number" min="1" max="600" placeholder="用户搜索限速" />
          <button type="submit">创建</button>
        </form>

        <div className="adminTableToolbar">
          <span>
            <Users size={15} aria-hidden="true" />
            共 {userList.totalUsers} 个用户
          </span>
        </div>

        <AdminUserTable users={userList.users} page={userList.page} totalPages={userList.totalPages} totalUsers={userList.totalUsers} />
        <Pagination page={userList.page} totalPages={userList.totalPages} query={userList.query} basePath="/admin/users" />
      </article>
    </AdminFrame>
  );
}
