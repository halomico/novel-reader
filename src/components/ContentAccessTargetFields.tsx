"use client";

import { useId, useState } from "react";
import type { ContentAccessTargetType } from "@/lib/content-access";
import { AdminSelect } from "./AdminSelect";

const COUNTRY_OPTIONS = [
  ["CN", "中国"],
  ["HK", "中国香港"],
  ["TW", "中国台湾"],
  ["MO", "中国澳门"],
  ["JP", "日本"],
  ["KR", "韩国"],
  ["SG", "新加坡"],
  ["US", "美国"],
  ["CA", "加拿大"],
  ["GB", "英国"],
  ["DE", "德国"],
  ["FR", "法国"],
  ["NL", "荷兰"],
  ["RU", "俄罗斯"],
  ["AU", "澳大利亚"],
  ["IN", "印度"],
  ["BR", "巴西"],
  ["T1", "Tor 网络"],
  ["XX", "未知地区"],
] as const;

export function ContentAccessTargetFields({
  defaultType = "ip",
  defaultValue = "",
}: {
  defaultType?: ContentAccessTargetType;
  defaultValue?: string;
}) {
  const [type, setType] = useState<ContentAccessTargetType>(defaultType);
  const countryListId = useId();

  return (
    <>
      <label className="accessTypeField">
        <span>类型</span>
        <AdminSelect
          name="targetType"
          value={type}
          onChange={(event) => setType(event.target.value as ContentAccessTargetType)}
        >
          <option value="ip">IP</option>
          <option value="cidr">CIDR</option>
          <option value="country">国家</option>
          <option value="crawler">爬虫</option>
        </AdminSelect>
      </label>
      <label className="accessTargetField">
        <span>目标</span>
        {type === "crawler" ? (
          <>
            <input name="targetValue" type="hidden" value="known" />
            <span className="accessFixedTarget">已识别爬虫</span>
          </>
        ) : (
          <>
            <input
              name="targetValue"
              defaultValue={defaultValue}
              list={type === "country" ? countryListId : undefined}
              placeholder={type === "ip" ? "例如 203.0.113.8" : type === "cidr" ? "例如 203.0.113.0/24" : "两位国家代码"}
              required
            />
            {type === "country" ? (
              <datalist id={countryListId}>
                {COUNTRY_OPTIONS.map(([code, label]) => <option value={code} label={label} key={code} />)}
              </datalist>
            ) : null}
          </>
        )}
      </label>
    </>
  );
}
