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

function remainingMinutes(timestamp: number | null): number | null {
  return timestamp ? Math.max(0, Math.ceil((timestamp - Date.now()) / 60_000)) : null;
}

function scopeLabel(scope: ContentAccessRule["scope"]): string {
  return scope === "novel" ? "仅正文" : scope === "media" ? "仅媒体" : "全站";
}

function targetLabel(rule: ContentAccessRule): string {
  if (rule.targetType === "crawler") return "已识别爬虫";
  if (rule.targetType !== "country") return rule.targetValue;
  const countries = rule.targetValue.split(",").join("、");
  return `${rule.matchMode === "exclude" ? "不在" : "位于"} ${countries}`;
}

function durationLabel(expiresAt: number | null): string {
  const minutes = remainingMinutes(expiresAt);
  if (minutes === null) return "长期有效";
  return minutes > 0 ? `剩余 ${minutes} 分钟` : "已到期";
}

function RuleEditor({ rule }: { rule?: ContentAccessRule }) {
  const generated = rule?.source === "rate_limit";
  if (generated && rule) {
    return (
      <div className="accessGeneratedRow">
        <span className="accessRuleTarget">{rule.targetValue}</span>
        <span>{scopeLabel(rule.scope)}</span>
        <span>{rule.reason || "频率保护"}</span>
        <span>{durationLabel(rule.expiresAt)}</span>
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
    <form className={rule ? "accessRuleBuilder" : "accessRuleBuilder isCreate"} action={saveContentAccessRuleAction}>
      {rule ? <input name="id" type="hidden" value={rule.id} /> : null}
      <section className="accessConditionBuilder">
        <span className="accessBuilderLabel">当请求匹配</span>
        <div className="accessConditionRow">
          <ContentAccessTargetFields
            defaultType={rule?.targetType}
            defaultValue={rule?.targetValue}
            defaultMatchMode={rule?.matchMode}
          />
        </div>
      </section>
      <section className="accessRuleContext">
        <label>
          <span>范围</span>
          <AdminSelect name="scope" defaultValue={rule?.scope || "all"}>
            <option value="all">全站</option>
            <option value="novel">仅正文</option>
            <option value="media">仅媒体</option>
          </AdminSelect>
        </label>
        <label>
          <span>对象</span>
          <AdminSelect name="audience" defaultValue={rule?.audience || "all"}>
            <option value="all">全部访客</option>
            <option value="guest">仅未登录</option>
          </AdminSelect>
        </label>
        <label>
          <span>持续时间</span>
          <span className="accessNumberUnit">
            <input
              name="durationMinutes"
              type="number"
              min="1"
              max="525600"
              defaultValue={remainingMinutes(rule?.expiresAt || null) || ""}
              placeholder="留空为长期"
            />
            <small>分钟</small>
          </span>
        </label>
        <label className="accessReasonField">
          <span>备注</span>
          <input name="reason" defaultValue={rule?.reason || ""} maxLength={120} placeholder="可选" />
        </label>
      </section>
      <footer className="accessRuleActions">
        <span className="accessRuleOutcome">命中后阻止访问</span>
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
      </footer>
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
            <p>应用层前台访问规则。后台始终保留恢复入口，边缘 WAF 与挑战仍在 Cloudflare 管理。</p>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </header>

        <section className="accessSection">
          <div className="accessSectionHeading">
            <div>
              <h3>封禁规则</h3>
              <p>按字段、运算符和值匹配请求；国家判断依赖 Cloudflare 的 CF-IPCountry 请求头。</p>
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
                  <span className="accessRuleTarget">{targetLabel(rule)}</span>
                  <span>{scopeLabel(rule.scope)}</span>
                  <small>{rule.enabled ? "启用" : "停用"} · {durationLabel(rule.expiresAt)}{rule.reason ? ` · ${rule.reason}` : ""}</small>
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
                    <option value="all">全站</option>
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
                  <span>窗口 / 分钟</span>
                  <input name="windowMinutes" type="number" min="1" max="1440" defaultValue={Math.max(1, Math.ceil(policy.windowSeconds / 60))} />
                </label>
                <label>
                  <span>请求上限</span>
                  <input name="maxRequests" type="number" min="1" max="100000" defaultValue={policy.maxRequests} />
                </label>
                <label>
                  <span>暂停 / 分钟</span>
                  <input name="blockMinutes" type="number" min="1" max="525600" defaultValue={Math.max(1, Math.ceil(policy.blockSeconds / 60))} />
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
                  <option value="all">全站</option>
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
              <label><span>窗口 / 分钟</span><input name="windowMinutes" type="number" min="1" max="1440" defaultValue="1" /></label>
              <label><span>请求上限</span><input name="maxRequests" type="number" min="1" max="100000" defaultValue="60" /></label>
              <label><span>暂停 / 分钟</span><input name="blockMinutes" type="number" min="1" max="525600" defaultValue="5" /></label>
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
