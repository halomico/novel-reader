import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { AdminInviteGenerator } from "@/components/AdminInviteGenerator";
import { listRegistrationInvites } from "@/lib/registration-invites";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminInvitesPage() {
  const invites = listRegistrationInvites(100);
  return (
    <AdminFrame
      active="users"
      breadcrumbs={[{ label: "用户管理", href: "/admin/users" }, { label: "邀请码" }]}
    >
      <article className="adminPanel">
        <header className="adminPanelHeader">
          <div><h2>邀请码</h2><p>原码不会入库，生成后请立即保存。</p></div>
          <KeyRound size={20} aria-hidden="true" />
        </header>
        <AdminInviteGenerator />
        <div className="adminMarketBatchList">
          {invites.map((invite) => (
            <span key={invite.id}>
              <strong>{invite.label || `尾号 ${invite.hint}`}</strong>
              <small>{invite.usedCount}/{invite.maxUses}{invite.enabled ? "" : " · 已停用"}</small>
            </span>
          ))}
        </div>
      </article>
    </AdminFrame>
  );
}
