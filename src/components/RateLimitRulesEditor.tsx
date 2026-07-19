"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AdminSelect } from "@/components/AdminSelect";
import type { IpRateLimitRule } from "@/lib/site-settings";

type RateLimitRulesEditorProps = {
  fieldName: string;
  title: string;
  variant: "search" | "content";
  initialRules: IpRateLimitRule[];
  defaultMaxRequests: number;
};

function newRule(variant: RateLimitRulesEditorProps["variant"], maxRequests: number): IpRateLimitRule {
  return {
    id: `${variant}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    enabled: true,
    scope: "all",
    queryType: "all",
    windowSeconds: 60,
    maxRequests,
    banMode: "none",
    banSeconds: 3_600,
  };
}

export function RateLimitRulesEditor({
  fieldName,
  title,
  variant,
  initialRules,
  defaultMaxRequests,
}: RateLimitRulesEditorProps) {
  const [rules, setRules] = useState<IpRateLimitRule[]>(
    initialRules.length ? initialRules : [newRule(variant, defaultMaxRequests)],
  );

  function updateRule(id: string, patch: Partial<IpRateLimitRule>) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  function addRule() {
    setRules((current) =>
      current.length >= 20 ? current : [...current, newRule(variant, defaultMaxRequests)],
    );
  }

  function removeRule(id: string) {
    setRules((current) => (current.length > 1 ? current.filter((rule) => rule.id !== id) : current));
  }

  return (
    <div className={`searchRateRulesEditor rateLimitRulesEditor is-${variant}`}>
      <input name={fieldName} type="hidden" value={JSON.stringify(rules)} />
      <div className="searchRateRulesHeader">
        <strong>{title}</strong>
        <button
          className="searchRateRuleIconButton"
          type="button"
          onClick={addRule}
          disabled={rules.length >= 20}
          aria-label={`新增${title}`}
          title="新增规则"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="searchRateRulesList">
        {rules.map((rule, index) => (
          <div className="searchRateRule" key={rule.id}>
            <label className="searchRateRuleEnabled">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
              />
              <span>规则 {index + 1}</span>
            </label>
            {variant === "search" ? (
              <>
                <label>
                  <span>适用对象</span>
                  <AdminSelect
                    value={rule.scope}
                    onChange={(event) => updateRule(rule.id, { scope: event.target.value as IpRateLimitRule["scope"] })}
                  >
                    <option value="all">全部用户</option>
                    <option value="guest">未登录访客</option>
                    <option value="user">登录用户</option>
                  </AdminSelect>
                </label>
                <label>
                  <span>搜索类型</span>
                  <AdminSelect
                    value={rule.queryType}
                    onChange={(event) => updateRule(rule.id, { queryType: event.target.value as IpRateLimitRule["queryType"] })}
                  >
                    <option value="all">全部搜索</option>
                    <option value="short">仅双字短词</option>
                  </AdminSelect>
                </label>
              </>
            ) : null}
            <label>
              <span>窗口 / 秒</span>
              <input
                type="number"
                min="1"
                max="86400"
                value={rule.windowSeconds}
                onChange={(event) => updateRule(rule.id, { windowSeconds: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>单 IP 次数</span>
              <input
                type="number"
                min="1"
                max="100000"
                value={rule.maxRequests}
                onChange={(event) => updateRule(rule.id, { maxRequests: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>超限处理</span>
              <AdminSelect
                value={rule.banMode}
                onChange={(event) => updateRule(rule.id, { banMode: event.target.value as IpRateLimitRule["banMode"] })}
              >
                <option value="none">仅等待窗口</option>
                <option value="temporary">临时封禁</option>
                <option value="permanent">永久封禁</option>
              </AdminSelect>
            </label>
            {rule.banMode === "temporary" ? (
              <label>
                <span>封禁 / 分钟</span>
                <input
                  type="number"
                  min="1"
                  max="525600"
                  value={Math.max(1, Math.round(rule.banSeconds / 60))}
                  onChange={(event) => updateRule(rule.id, { banSeconds: Number(event.target.value) * 60 })}
                />
              </label>
            ) : (
              <span className="searchRateRuleSpacer" aria-hidden="true" />
            )}
            <button
              className="searchRateRuleIconButton isDanger"
              type="button"
              onClick={() => removeRule(rule.id)}
              disabled={rules.length === 1}
              aria-label={`删除${title} ${index + 1}`}
              title="删除规则"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
