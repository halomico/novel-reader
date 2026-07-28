import { ChevronDown, Clock3, Gauge, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { AdminSelect } from "@/components/AdminSelect";
import { ContentAccessTargetFields } from "@/components/ContentAccessTargetFields";
import {
  listContentAccessPolicies,
  listContentAccessRules,
  type ContentAccessCountryMode,
  type ContentAccessPolicy,
  type ContentAccessRule,
  type ContentAccessScope,
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

const SCOPE_OPTIONS: Array<[ContentAccessScope, string]> = [
  ["all", "全站"],
  ["novel", "小说"],
  ["video", "视频"],
  ["audio", "音频"],
  ["file", "文件"],
];

const COUNTRY_MODE_OPTIONS: Array<[ContentAccessCountryMode, string]> = [
  ["all", "全部地区"],
  ["cn", "仅 CN"],
  ["non_cn", "仅非 CN"],
];

function remainingMinutes(timestamp: number | null): number | null {
  return timestamp ? Math.max(0, Math.ceil((timestamp - Date.now()) / 60_000)) : null;
}

function scopeLabel(scope: ContentAccessScope): string {
  return SCOPE_OPTIONS.find(([value]) => value === scope)?.[1] || "全站";
}

function countryModeLabel(mode: ContentAccessCountryMode): string {
  return COUNTRY_MODE_OPTIONS.find(([value]) => value === mode)?.[1] || "全部地区";
}

function targetLabel(rule: ContentAccessRule): string {
  if (rule.targetType === "crawler") {
    if (rule.targetValue === "headless") return "无头浏览器";
    if (rule.targetValue === "crawler") return "常规爬虫";
    return "爬虫与无头浏览器";
  }
  if (rule.targetType !== "country") return rule.targetValue;
  const countries = rule.targetValue.split(",").join("、");
  return `${rule.matchMode === "exclude" ? "不在" : "位于"} ${countries}`;
}

function durationLabel(expiresAt: number | null): string {
  const minutes = remainingMinutes(expiresAt);
  if (minutes === null) return "长期";
  return minutes > 0 ? `${minutes} 分钟` : "已到期";
}

function ScopeSelect({ defaultValue }: { defaultValue: ContentAccessScope }) {
  return (
    <AdminSelect name="scope" defaultValue={defaultValue}>
      {SCOPE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </AdminSelect>
  );
}

function CountryModeSelect({ defaultValue }: { defaultValue: ContentAccessCountryMode }) {
  return (
    <AdminSelect name="countryMode" defaultValue={defaultValue}>
      {COUNTRY_MODE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </AdminSelect>
  );
}

function EnabledToggle({ defaultChecked, label = "启用" }: { defaultChecked: boolean; label?: string }) {
  return (
    <label className="settingToggle accessEnabledToggle">
      <input name="enabled" type="checkbox" defaultChecked={defaultChecked} />
      <span>{label}</span>
      <span className="settingToggleTrack" aria-hidden="true"><span /></span>
    </label>
  );
}

function RuleEditor({ rule }: { rule?: ContentAccessRule }) {
  const generated = rule?.source === "rate_limit";
  if (generated && rule) {
    return (
      <div className="accessGeneratedRow">
        <span className="accessRuleTarget">{rule.targetValue}</span>
        <span>{scopeLabel(rule.scope)}</span>
        <span>{countryModeLabel(rule.countryMode)}</span>
        <span>{rule.reason || "频率保护"}</span>
        <span>{durationLabel(rule.expiresAt)}</span>
        <form action={deleteContentAccessRuleAction}>
          <input name="id" type="hidden" value={rule.id} />
          <button className="adminIconButton accessDeleteButton" type="submit" title="解除" aria-label={`解除 ${rule.targetValue}`}>
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
        <span className="accessBuilderLabel">匹配请求</span>
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
          <span>访问范围</span>
          <ScopeSelect defaultValue={rule?.scope || "all"} />
        </label>
        <label>
          <span>地区条件</span>
          <CountryModeSelect defaultValue={rule?.countryMode || "all"} />
        </label>
        <label>
          <span>访问对象</span>
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
        <span className="accessRuleOutcome">命中后暂停访问</span>
        <EnabledToggle defaultChecked={rule?.enabled ?? true} />
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

function PolicyEditor({ policy }: { policy?: ContentAccessPolicy }) {
  return (
    <form className="accessPolicyEditor" action={saveContentAccessPolicyAction}>
      {policy ? <input name="id" type="hidden" value={policy.id} /> : null}
      <label className="accessPolicyName">
        <span>名称</span>
        <input name="name" defaultValue={policy?.name || "内容访问保护"} maxLength={40} />
      </label>
      <label>
        <span>访问范围</span>
        <ScopeSelect defaultValue={policy?.scope || "all"} />
      </label>
      <label>
        <span>地区条件</span>
        <CountryModeSelect defaultValue={policy?.countryMode || "all"} />
      </label>
      <label>
        <span>访问对象</span>
        <AdminSelect name="audience" defaultValue={policy?.audience || "guest"}>
          <option value="guest">仅未登录</option>
          <option value="all">全部访客</option>
        </AdminSelect>
      </label>
      <label>
        <span>统计窗口</span>
        <span className="accessNumberUnit">
          <input name="windowMinutes" type="number" min="1" max="1440" defaultValue={Math.max(1, Math.ceil((policy?.windowSeconds || 60) / 60))} />
          <small>分钟</small>
        </span>
      </label>
      <label>
        <span>请求上限</span>
        <input name="maxRequests" type="number" min="1" max="100000" defaultValue={policy?.maxRequests || 60} />
      </label>
      <label>
        <span>暂停时间</span>
        <span className="accessNumberUnit">
          <input name="blockMinutes" type="number" min="1" max="525600" defaultValue={Math.max(1, Math.ceil((policy?.blockSeconds || 300) / 60))} />
          <small>分钟</small>
        </span>
      </label>
      <footer className="accessPolicyActions">
        <EnabledToggle defaultChecked={policy?.enabled ?? true} />
        <button className="adminCompactButton" type="submit">
          <Save size={15} aria-hidden="true" />
          保存
        </button>
        {policy ? (
          <button
            className="adminIconButton accessDeleteButton"
            type="submit"
            formAction={deleteContentAccessPolicyAction}
            title="删除"
            aria-label={`删除 ${policy.name}`}
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
            <p>管理应用层内容访问；后台始终保留恢复入口，网络挑战与防火墙仍交由 Cloudflare。</p>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </header>

        <section className="accessSection">
          <div className="accessSectionHeading">
            <div>
              <h3>访问规则</h3>
              <p>可组合 IP、地区、爬虫特征、内容范围和登录状态；国家判断依赖 CF-IPCountry。</p>
            </div>
            <span>{manualRules.length} 条</span>
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
                  <span className="accessRuleChip">{scopeLabel(rule.scope)}</span>
                  <span className="accessRuleChip">{countryModeLabel(rule.countryMode)}</span>
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

        <section className="accessSection">
          <div className="accessSectionHeading">
            <div>
              <h3>访问频率</h3>
              <p>仅在命中条件的请求超过上限后，按 IP 创建临时暂停规则。</p>
            </div>
            <span>{policies.length} 条</span>
          </div>
          <details className="accessCreateDisclosure">
            <summary>
              <span><Gauge size={15} aria-hidden="true" />新建策略</span>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <PolicyEditor />
          </details>
          <div className="accessPolicyList">
            {policies.length ? policies.map((policy) => (
              <details className="accessPolicyDisclosure" key={policy.id}>
                <summary>
                  <span>{policy.name}</span>
                  <span className="accessRuleChip">{scopeLabel(policy.scope)}</span>
                  <span className="accessRuleChip">{countryModeLabel(policy.countryMode)}</span>
                  <small>{policy.enabled ? "启用" : "停用"} · {policy.windowSeconds / 60} 分钟内 {policy.maxRequests} 次</small>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <PolicyEditor policy={policy} />
              </details>
            )) : <p className="adminInlineEmpty">暂无频率策略</p>}
          </div>
        </section>

        {generatedRules.length ? (
          <details className="accessSection accessGeneratedDisclosure">
            <summary>
              <span><Clock3 size={17} aria-hidden="true" />临时暂停</span>
              <small>{generatedRules.length} 条</small>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div className="accessGeneratedList">
              {generatedRules.map((rule) => <RuleEditor rule={rule} key={rule.id} />)}
            </div>
          </details>
        ) : null}
      </article>
    </AdminFrame>
  );
}
