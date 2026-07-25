import { Save, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { listUserLevelDefinitions, USER_PERMISSION_DEFINITIONS } from "@/lib/user-levels";
import { saveUserLevelsAction } from "../../actions";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminUserLevelsPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AdminUserLevelsPage({ searchParams }: AdminUserLevelsPageProps) {
  const params = await searchParams;
  const levels = listUserLevelDefinitions();

  return (
    <AdminFrame
      active="users"
      notice={params.notice}
      tone={params.tone}
      breadcrumbs={[{ label: "用户管理", href: "/admin/users" }, { label: "等级权限" }]}
    >
      <article className="adminPanel adminUserLevelsPanel">
        <header className="adminPanelHeader">
          <div>
            <h2>等级权限</h2>
            <p>配置前台 Lv.1–Lv.7 的名称与可用功能。前台管理员不受此处限制。</p>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </header>
        <form className="adminUserLevelsForm" action={saveUserLevelsAction}>
          <div className="adminUserLevelList">
            {levels.map((level) => (
              <section className="adminUserLevelRow" key={level.level}>
                <strong className="adminUserLevelIndex">Lv.{level.level + 1}</strong>
                <label className="adminUserLevelName">
                  <span className="srOnly">等级名称</span>
                  <input
                    name={`levelName:${level.level}`}
                    defaultValue={level.name}
                    maxLength={20}
                    required
                  />
                </label>
                <div className="adminUserLevelPermissions">
                  {USER_PERMISSION_DEFINITIONS.map((permission) => (
                    <label key={permission.key}>
                      <input
                        name={`permissions:${level.level}`}
                        type="checkbox"
                        value={permission.key}
                        defaultChecked={level.permissions.includes(permission.key)}
                      />
                      <span>{permission.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="adminEditorActions">
            <button type="submit"><Save size={15} aria-hidden="true" />保存</button>
          </div>
        </form>
      </article>
    </AdminFrame>
  );
}
