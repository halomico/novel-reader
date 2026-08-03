import { ChevronDown, Clock3, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import {
  grantAdminUserEntitlementAction,
  revokeAdminUserEntitlementAction,
  updateAdminUserEntitlementAction,
} from "@/app/admin/actions";
import {
  ENTITLEMENT_TARGET_RIGHTS,
  type EntitlementRight,
  type EntitlementTargetType,
  type UserEntitlementPage,
} from "@/lib/entitlements";
import { AdminEntitlementPicker } from "./AdminEntitlementPicker";
import { AdminSelect } from "./AdminSelect";
import { Pagination } from "./Pagination";

const TYPE_LABELS: Record<EntitlementTargetType, string> = {
  novel: "小说",
  novel_source: "小说来源",
  video: "视频",
  video_category: "视频分类",
  video_tag: "视频标签",
  audio: "音频",
  audio_folder: "音频目录",
  file: "文件",
  file_folder: "文件目录",
};

const RIGHT_LABELS: Record<EntitlementRight, string> = {
  read: "阅读",
  play: "播放",
  view: "查看",
  download: "下载",
};

function expiryLabel(value: string | null, active: boolean): string {
  if (!value) return "永久有效";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "有效期未知";
  return `${active ? "有效至" : "已于"} ${date.toLocaleString("zh-CN", { hour12: false })}`;
}

export function AdminUserEntitlementPanel({
  userId,
  entitlements,
  returnPath,
}: {
  userId: number;
  entitlements: UserEntitlementPage;
  returnPath?: string;
}) {
  return (
    <section className="adminUserRights" id="user-rights">
      <header className="adminPanelHeader">
        <div>
          <h2>用户权益</h2>
          <p>按具体资源授予访问能力和有效期，不改变用户等级。</p>
        </div>
        <ShieldCheck size={20} aria-hidden="true" />
      </header>

      <details className="adminUserRightsGrant">
        <summary><Plus size={15} aria-hidden="true" />授予权益<ChevronDown size={15} aria-hidden="true" /></summary>
        <form action={grantAdminUserEntitlementAction}>
          <input name="userId" type="hidden" value={userId} />
          <AdminEntitlementPicker initial={null} />
          <footer><button className="adminPrimaryButton" type="submit"><ShieldCheck size={15} aria-hidden="true" />授予</button></footer>
        </form>
      </details>

      <div className="adminUserRightsList">
        {entitlements.items.length ? entitlements.items.map((item) => (
          <details className={item.active ? "adminUserRightRow" : "adminUserRightRow isExpired"} key={item.id}>
            <summary>
              <span className="adminUserRightIcon"><ShieldCheck size={16} aria-hidden="true" /></span>
              <span className="adminUserRightCopy">
                <strong>{item.targetLabel}</strong>
                <small>{TYPE_LABELS[item.targetType]} · {item.rights.map((right) => RIGHT_LABELS[right]).join("、")} · {item.sourceLabel}</small>
              </span>
              <span className={item.active ? "adminStatusBadge isLive" : "adminStatusBadge"}>{item.active ? "有效" : "已过期"}</span>
              <span className="adminUserRightExpiry"><Clock3 size={13} aria-hidden="true" />{expiryLabel(item.expiresAt, item.active)}</span>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <form className="adminUserRightEditor" action={updateAdminUserEntitlementAction}>
              <input name="userId" type="hidden" value={userId} />
              <input name="entitlementId" type="hidden" value={item.id} />
              <fieldset>
                <legend>权限</legend>
                {ENTITLEMENT_TARGET_RIGHTS[item.targetType].map((right) => (
                  <label key={right}>
                    <input name="rights" type="checkbox" value={right} defaultChecked={item.rights.includes(right)} />
                    <span>{RIGHT_LABELS[right]}</span>
                  </label>
                ))}
              </fieldset>
              <label className="adminUserRightDuration">
                <span>有效期</span>
                <AdminSelect name="expiryMode" defaultValue="keep">
                  <option value="keep">保持不变</option>
                  <option value="permanent">永久</option>
                  <option value="7">从现在起 7 天</option>
                  <option value="30">从现在起 30 天</option>
                  <option value="90">从现在起 90 天</option>
                  <option value="365">从现在起 1 年</option>
                </AdminSelect>
              </label>
              <footer>
                <button className="adminDangerButton" type="submit" formAction={revokeAdminUserEntitlementAction}><Trash2 size={14} aria-hidden="true" />撤销</button>
                <button className="adminPrimaryButton" type="submit"><Save size={14} aria-hidden="true" />保存</button>
              </footer>
            </form>
          </details>
        )) : <p className="adminInlineEmpty">尚未授予资源权益。</p>}
      </div>

      <Pagination
        page={entitlements.page}
        totalPages={entitlements.totalPages}
        query=""
        basePath={`/admin/users/${userId}`}
        pageParam="rightsPage"
        extraParams={{ view: "rights", returnPath }}
      />
    </section>
  );
}
