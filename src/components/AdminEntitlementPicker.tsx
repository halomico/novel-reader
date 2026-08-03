"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  EntitlementDefinition,
  EntitlementRight,
  EntitlementTargetOption,
  EntitlementTargetType,
} from "@/lib/entitlement-protocol";
import { AdminSelect } from "./AdminSelect";

const TARGET_OPTIONS: Array<{ value: EntitlementTargetType; label: string; group: string }> = [
  { value: "novel", label: "单本小说", group: "小说" },
  { value: "novel_source", label: "小说来源", group: "小说" },
  { value: "video", label: "单个视频", group: "视频" },
  { value: "video_category", label: "视频分类", group: "视频" },
  { value: "video_tag", label: "视频标签", group: "视频" },
  { value: "audio", label: "单个音频", group: "音频" },
  { value: "audio_folder", label: "音频目录", group: "音频" },
  { value: "file", label: "单个文件", group: "文件" },
  { value: "file_folder", label: "文件目录", group: "文件" },
];

const RIGHT_LABELS: Record<EntitlementRight, string> = {
  read: "阅读",
  play: "播放",
  view: "查看",
  download: "下载",
};

type TargetResponse = {
  ok: boolean;
  targets?: EntitlementTargetOption[];
  rights?: EntitlementRight[];
};

export function AdminEntitlementPicker({ initial }: { initial: EntitlementDefinition | null }) {
  const [targetType, setTargetType] = useState<EntitlementTargetType>(initial?.targetType || "novel");
  const [targetId, setTargetId] = useState(initial?.targetId || "");
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<EntitlementTargetOption[]>([]);
  const [allowedRights, setAllowedRights] = useState<EntitlementRight[]>([]);
  const [rights, setRights] = useState<EntitlementRight[]>(initial?.rights || []);
  const [loading, setLoading] = useState(true);
  const durationDays = initial?.durationSeconds ? Math.max(Math.round(initial.durationSeconds / 86_400), 1) : 0;
  const selected = useMemo(() => targets.find((target) => target.id === targetId) || null, [targetId, targets]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ type: targetType, q: query });
        if (targetId) params.set("selected", targetId);
        const response = await fetch(`/admin/market/targets?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json() as TargetResponse;
        if (!response.ok || !body.ok) return;
        const nextRights = body.rights || [];
        setTargets(body.targets || []);
        setAllowedRights(nextRights);
        setRights((current) => {
          const valid = current.filter((right) => nextRights.includes(right));
          return valid.length ? valid : nextRights.slice(0, 1);
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, targetId, targetType]);

  function changeType(next: EntitlementTargetType) {
    setTargetType(next);
    setTargetId("");
    setQuery("");
    setTargets([]);
    setRights([]);
  }

  function toggleRight(right: EntitlementRight) {
    setRights((current) => current.includes(right)
      ? current.length === 1 ? current : current.filter((item) => item !== right)
      : [...current, right]);
  }

  return (
    <div className="adminEntitlementPicker isFull">
      <div className="adminEntitlementTopRow">
        <label>
          <span>资源范围</span>
          <AdminSelect name="targetType" value={targetType} onChange={(event) => changeType(event.target.value as EntitlementTargetType)}>
            {Array.from(new Set(TARGET_OPTIONS.map((option) => option.group))).map((group) => (
              <optgroup label={group} key={group}>
                {TARGET_OPTIONS.filter((option) => option.group === group).map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </AdminSelect>
        </label>
        <label>
          <span>有效期</span>
          <AdminSelect name="durationDays" defaultValue={String(durationDays)}>
            <option value="0">永久</option>
            <option value="1">1 天</option>
            <option value="7">7 天</option>
            <option value="30">30 天</option>
            <option value="90">90 天</option>
            <option value="365">1 年</option>
          </AdminSelect>
        </label>
      </div>
      <label className="adminEntitlementSearch">
        <span>选择资源</span>
        <span><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称" /></span>
      </label>
      <input name="targetId" type="hidden" value={targetId} />
      <div className="adminEntitlementResults" role="listbox" aria-label="资源搜索结果">
        {targets.map((target) => (
          <button
            className={target.id === targetId ? "isSelected" : ""}
            type="button"
            role="option"
            aria-selected={target.id === targetId}
            onClick={() => setTargetId(target.id)}
            key={target.id}
          >
            <span><strong>{target.label}</strong><small>{target.meta}</small></span>
            {target.id === targetId ? <Check size={15} aria-hidden="true" /> : null}
          </button>
        ))}
        {!loading && !targets.length ? <p>没有匹配的资源</p> : null}
        {loading ? <p>正在读取...</p> : null}
      </div>
      {selected ? <p className="adminEntitlementSelected">已选择 <strong>{selected.label}</strong></p> : null}
      <fieldset className="adminEntitlementRights">
        <legend>授予权限</legend>
        {allowedRights.map((right) => (
          <label key={right}>
            <input
              name="rights"
              type="checkbox"
              value={right}
              checked={rights.includes(right)}
              onChange={() => toggleRight(right)}
            />
            <span><Check size={12} aria-hidden="true" /></span>
            {RIGHT_LABELS[right]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
