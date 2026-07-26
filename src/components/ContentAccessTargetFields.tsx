"use client";

import { ChevronDown, Globe2 } from "lucide-react";
import { useState } from "react";
import type { ContentAccessMatchMode, ContentAccessTargetType } from "@/lib/content-access";
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

const COUNTRY_LABELS = new Map<string, string>(COUNTRY_OPTIONS);

function countryCodes(value: string): string[] {
  return [...new Set(
    value
      .split(/[\s,，、]+/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  )];
}

export function ContentAccessTargetFields({
  defaultType = "ip",
  defaultValue = "",
  defaultMatchMode = "include",
}: {
  defaultType?: ContentAccessTargetType;
  defaultValue?: string;
  defaultMatchMode?: ContentAccessMatchMode;
}) {
  const [type, setType] = useState<ContentAccessTargetType>(defaultType);
  const [matchMode, setMatchMode] = useState<ContentAccessMatchMode>(defaultMatchMode);
  const [targetText, setTargetText] = useState(defaultType === "ip" || defaultType === "cidr" ? defaultValue : "");
  const [countryText, setCountryText] = useState(defaultType === "country" ? defaultValue : "");
  const countries = countryCodes(countryText);

  function toggleCountry(code: string) {
    setCountryText(
      (countries.includes(code)
        ? countries.filter((item) => item !== code)
        : [...countries, code]
      ).join(","),
    );
  }

  function changeType(nextType: ContentAccessTargetType) {
    setType(nextType);
    if (nextType === "country" && type !== "country") {
      setCountryText("");
    } else if ((nextType === "ip" || nextType === "cidr") && nextType !== type) {
      setTargetText("");
    }
  }

  return (
    <>
      <label className="accessTypeField">
        <span>字段</span>
        <AdminSelect
          name="targetType"
          value={type}
          onChange={(event) => changeType(event.target.value as ContentAccessTargetType)}
        >
          <option value="ip">IP</option>
          <option value="cidr">CIDR</option>
          <option value="country">国家</option>
          <option value="crawler">爬虫</option>
        </AdminSelect>
      </label>
      <label className="accessOperatorField">
        <span>运算符</span>
        {type === "country" ? (
          <AdminSelect
            name="matchMode"
            value={matchMode}
            onChange={(event) => setMatchMode(event.target.value as ContentAccessMatchMode)}
          >
            <option value="include">位于列表中</option>
            <option value="exclude">不在列表中</option>
          </AdminSelect>
        ) : (
          <>
            <input name="matchMode" type="hidden" value="include" />
            <span className="accessFixedTarget">匹配</span>
          </>
        )}
      </label>
      <div className="accessValueField">
        <span>值</span>
        {type === "country" ? (
          <div className="accessCountryPicker">
            <details>
              <summary>
                <Globe2 size={15} aria-hidden="true" />
                <span>
                  {countries.length
                    ? countries.length <= 3
                      ? countries.map((code) => COUNTRY_LABELS.get(code) || code).join("、")
                      : `已选择 ${countries.length} 个地区`
                    : "选择国家或地区"}
                </span>
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className="accessCountryOptions">
                <label className="accessCountryCodeInput">
                  <span>国家代码</span>
                  <input
                    name="targetValue"
                    value={countryText}
                    onChange={(event) => setCountryText(event.target.value.toUpperCase())}
                    placeholder="例如 CN, JP, US"
                  />
                </label>
                {COUNTRY_OPTIONS.map(([code, label]) => (
                  <label key={code}>
                    <input
                      type="checkbox"
                      checked={countries.includes(code)}
                      onChange={() => toggleCountry(code)}
                    />
                    <span>{label}</span>
                    <small>{code}</small>
                  </label>
                ))}
              </div>
            </details>
          </div>
        ) : type === "crawler" ? (
          <>
            <input name="targetValue" type="hidden" value="known" />
            <span className="accessFixedTarget">已识别爬虫</span>
          </>
        ) : (
          <label>
            <input
              name="targetValue"
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              placeholder={type === "ip" ? "例如 203.0.113.8" : "例如 203.0.113.0/24"}
              required
            />
          </label>
        )}
      </div>
    </>
  );
}
