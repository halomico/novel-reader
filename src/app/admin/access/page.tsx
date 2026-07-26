import { ChevronDown, Clock3, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { AdminSelect } from "@/components/AdminSelect";
import { ContentAccessTargetFields } from "@/components/ContentAccessTargetFields";
import {
  listContentAccessPolicies,
  listContentAccessRules,
  type ContentAccessRule,
} from "@/lib/content-access";
import { AdminFrame } from "../AdminFrame";
import {
  deleteContentAccessPolicyAction,
  deleteContentAccessRuleAction,
  saveContentAccessPolicyAction,
  saveContentAccessRuleAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AccessPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

function localDateTime(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function scopeLabel(scope: ContentAccessRule["scope"]): string {
  return scope === "novel" ? "正文" : scope === "media" ? "媒体" : "正文与媒体";
}

function RuleEditor({ rule }: { rule?: ContentAccessRule }) {
  const generated = rule?.source === "rate_limit";
  if (generated && rule) {
    return (
      <div className="accessGeneratedRow">
        <span className="accessRuleTarget">{rule.targetValue}</span>
        <span>{scopeLabel(rule.scope)}</span>
        <span>{rule.reason || "频率保护"}</span>
        <time dateTime={rule.expiresAt ? new Date(rule.expiresAt).toISOString() : undefined}>
          {rule.expiresAt ? new Date(rule.expiresAt).toLocaleString("zh-CN", { hour12: false }) : "待管理员处理"}
        </time>
        <form action={deleteContentAccessRuleAction}>
          <input name="id" type="hidden" value={rule.id} />
          <button className="adminIconButton" type="submit" title="解除" aria-label={`解除 ${rule.targetValue}`}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </form>
      </div>
    );
  }

  return (
    <form className={rule ? "accessRuleEditor" : "accessRuleEditor isCreate"} action={saveContentAccessRuleAction}>
      {rule ? <input name="id" type="hidden" value={rule.id} /> : null}
      <ContentAccessTargetFields defaultType={rule?.targetType} defaultValue={rule?.targetValue} />
      <label className="accessScopeField">
        <span>范围</span>
        <AdminSelect name="scope" defaultValue={rule?.scope || "all"}>
          <option value="all">正文与媒体</option>
          <option value="novel">仅正文</option>
          <option value="media">仅媒体</option>
        </AdminSelect>
      </label>
      <label className="accessAudienceField">
        <span>对象</span>
        <AdminSelect name="audience" defaultValue={rule?.audience || "all"}>
          <option value="all">全部访客</option>
          <option value="guest">仅未登录</option>
        </AdminSelect>
      </label>
      <label className="accessReasonField">
        <span>备注</span>
        <input name="reason" defaultValue={rule?.reason || ""} maxLength={120} placeholder="可选" />
      </label>
      <label className="accessExpiresField">
        <span>到期</span>
        <input name="expiresAt" type="datetime-local" defaultValue={localDateTime(rule?.expiresAt || null)} />
      </label>
      <div className="accessRuleActions">
        <label className="accessEnabledField">
          <input name="enabled" type="checkbox" defaultChecked={rule?.enabled ?? true} />
          <span>启用</span>
        </label>
        <button className="adminCompactButton" type="submit">
          <Save size={15} aria-hidden="true" />
          保存
        </button>
        {rule ? (
          <button
            className="adminIconButton accessDeleteButton"
            type="submit"
            formAction={deleteContentAccessRuleAction}
            title="删除"
            aria-label={`删除 ${rule.targetValue}`}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </form>
  );
}

export default async function AdminAccessPage({ searchParams }: AccessPageProps) {
  const params = await searchParams;
  const rules = listContentAccessRules();
  const policies = listContentAccessPolicies();
  const manualRules = rules.filter((rule) => rule.source === "manual");
  const generatedRules = rules.filter((rule) => rule.source === "rate_limit");

  return (
    <AdminFrame active="access" notice={params.notice} tone={params.tone}>
      <article className="adminPanel accessAdminPanel">
        <header className="adminPanelHeader">
          <div>
            <h2>内容访问</h2>
            <p>只控制小说正文与媒体内容。站点入口、后台和网络防护请在 Cloudflare 管理。</p>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </header>

        <section className="accessSection">
          <div className="accessSectionHeading">
            <div>
              <h3>封禁规则</h3>
              <p>支持 IP、CIDR、Cloudflare 国家代码和已识别爬虫。</p>
            </div>
          </div>
          <details className="accessCreateDisclosure">
            <summary>
              <span><Plus size={15} aria-hidden="true" />新建规则</span>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <RuleEditor />
          </details>
          <div className="accessRuleList">
            {manualRules.length ? manualRules.map((rule) => (
              <details className="accessRuleDisclosure" key={rule.id}>
                <summary>
                  <span className="accessRuleTarget">{rule.targetValue}</span>
                  <span>{scopeLabel(rule.scope)}</span>
                  <small>{rule.enabled ? "启用" : "停用"}{rule.reason ? ` · ${rule.reason}` : ""}</small>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <RuleEditor rule={rule} />
              </details>
            )) : (
              <p className="adminInlineEmpty">暂无手工规则</p>
            )}
          </div>
        </section>

        <details className="accessSection accessDisclosure">
          <summary>
            <span><Clock3 size={17} aria-hidden="true" />访问频率</span>
            <small>{policies.length} 条策略，{generatedRules.length} 个临时封禁</small>
          </summary>
          <div className="accessPolicyList">
            {policies.map((policy) => (
              <form className="accessPolicyEditor" action={saveContentAccessPolicyAction} key={policy.id}>
                <input name="id" type="hidden" value={policy.id} />
                <label>
                  <span>名称</span>
                  <input name="name" defaultValue={policy.name} maxLength={40} />
                </label>
                <label>
                  <span>范围</span>
                  <AdminSelect name="scope" defaultValue={policy.scope}>
                    <option value="all">正文与媒体</option>
                    <option value="novel">仅正文</option>
                    <option value="media">仅媒体</option>
                  </AdminSelect>
                </label>
                <label>
                  <span>对象</span>
                  <AdminSelect name="audience" defaultValue={policy.audience}>
                    <option value="guest">仅未登录</option>
                    <option value="all">全部访客</option>
                  </AdminSelect>
                </label>
                <label>
                  <span>窗口 / 秒</span>
                  <input name="windowSeconds" type="number" min="1" max="86400" defaultValue={policy.windowSeconds} />
                </label>
                <label>
                  <span>请求上限</span>
                  <input name="maxRequests" type="number" min="1" max="100000" defaultValue={policy.maxRequests} />
                </label>
                <label>
                  <span>暂停 / 秒</span>
                  <input name="blockSeconds" type="number" min="60" max="31536000" defaultValue={policy.blockSeconds} />
                </label>
                <label className="accessEnabledField">
                  <input name="enabled" type="checkbox" defaultChecked={policy.enabled} />
                  <span>启用</span>
                </label>
                <button className="adminIconButton" type="submit" title="保存" aria-label={`保存 ${policy.name}`}>
                  <Save size={16} aria-hidden="true" />
                </button>
                <button
                  className="adminIconButton"
                  type="submit"
                  formAction={deleteContentAccessPolicyAction}
                  title="删除"
                  aria-label={`删除 ${policy.name}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </form>
            ))}
            <form className="accessPolicyEditor isCreate" action={saveContentAccessPolicyAction}>
              <label><span>名称</span><input name="name" defaultValue="内容访问保护" maxLength={40} /></label>
              <label>
                <span>范围</span>
                <AdminSelect name="scope" defaultValue="all">
                  <option value="all">正文与媒体</option>
                  <option value="novel">仅正文</option>
                  <option value="media">仅媒体</option>
                </AdminSelect>
              </label>
              <label>
                <span>对象</span>
                <AdminSelect name="audience" defaultValue="guest">
                  <option value="guest">仅未登录</option>
                  <option value="all">全部访客</option>
                </AdminSelect>
              </label>
              <label><span>窗口 / 秒</span><input name="windowSeconds" type="number" min="1" max="86400" defaultValue="60" /></label>
              <label><span>请求上限</span><input name="maxRequests" type="number" min="1" max="100000" defaultValue="60" /></label>
              <label><span>暂停 / 秒</span><input name="blockSeconds" type="number" min="60" max="31536000" defaultValue="300" /></label>
              <input name="enabled" type="hidden" value="on" />
              <button className="adminCompactButton" type="submit"><Save size={15} aria-hidden="true" />保存</button>
            </form>
          </div>

          {generatedRules.length ? (
            <div className="accessGeneratedList">
              <h4>临时封禁</h4>
              {generatedRules.map((rule) => <RuleEditor rule={rule} key={rule.id} />)}
            </div>
          ) : null}
        </details>
      </article>
    </AdminFrame>
  );
}
