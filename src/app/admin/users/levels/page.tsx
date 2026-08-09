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
            <p>Lv.0 为未登录访客，登录用户从 Lv.1 开始；等级按累计获得的苏打自动提升。</p>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </header>
        <form className="adminUserLevelsForm" action={saveUserLevelsAction}>
          <div className="adminUserLevelList">
            {levels.map((level) => (
              <section className="adminUserLevelRow" key={level.level}>
                <strong className="adminUserLevelIndex">Lv.{level.level}</strong>
                <label className="adminUserLevelName">
                  <span className="srOnly">等级名称</span>
                  <input
                    name={`levelName:${level.level}`}
                    defaultValue={level.name}
                    maxLength={20}
                    required
                  />
                </label>
                <label className="adminUserLevelThreshold isSoda">
                  <span className="srOnly">所需累计苏打</span>
                  <input
                    name={`sodaRequired:${level.level}`}
                    type="number"
                    min={level.level < 2 ? 0 : 1}
                    max="2000000000"
                    defaultValue={level.sodaRequired}
                    disabled={level.level < 2}
                    aria-label={`Lv.${level.level} 所需累计苏打`}
                  />
                  <small>累计苏打</small>
                </label>
                <label className="adminUserLevelThreshold isVideo">
                  <span className="srOnly">视频并发</span>
                  <input
                    name={`videoConcurrencyLimit:${level.level}`}
                    type="number"
                    min="0"
                    max="20"
                    defaultValue={level.videoConcurrencyLimit}
                    disabled={level.level === 0}
                    aria-label={`Lv.${level.level} 视频并发`}
                  />
                  <small>视频并发</small>
                </label>
                <label className="adminUserLevelThreshold isDownload">
                  <span className="srOnly">每日下载次数</span>
                  <input
                    name={`dailyVideoDownloadLimit:${level.level}`}
                    type="number"
                    min="0"
                    max="1000"
                    defaultValue={level.dailyVideoDownloadLimit}
                    disabled={level.level === 0}
                    aria-label={`Lv.${level.level} 每日下载次数`}
                  />
                  <small>每日下载</small>
                </label>
                <div className="adminUserLevelPermissions">
                  {USER_PERMISSION_DEFINITIONS.map((permission) => (
                    <label key={permission.key}>
                      <input
                        name={`permissions:${level.level}`}
                        type="checkbox"
                        value={permission.key}
                        defaultChecked={level.permissions.includes(permission.key)}
                        disabled={level.level === 0}
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
