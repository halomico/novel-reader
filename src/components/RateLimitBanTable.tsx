"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deleteIpRateLimitBanAction } from "@/app/admin/actions";
import { LocalDateTime } from "@/components/LocalDateTime";
import type { IpRateLimitBan } from "@/lib/ip-rate-limit";

function banKey(ban: IpRateLimitBan): string {
  return JSON.stringify({ category: ban.category, ip: ban.ip });
}

const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });

function formatCountry(country: string): string {
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX") {
    return code && code !== "UNKNOWN" ? code : "未知";
  }
  const name = regionNames.of(code);
  return name && name !== code ? `${name} (${code})` : code;
}

export function RateLimitBanTable({ title, bans }: { title: string; bans: IpRateLimitBan[] }) {
  const entries = useMemo(() => bans.map((ban) => ({ ban, key: banKey(ban) })), [bans]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const allSelected = entries.length > 0 && entries.every((entry) => selectedKeys.includes(entry.key));

  useEffect(() => {
    setSelectedKeys([]);
  }, [bans]);

  function toggleAll() {
    setSelectedKeys(allSelected ? [] : entries.map((entry) => entry.key));
  }

  function toggleOne(key: string) {
    setSelectedKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  return (
    <section className="rateLimitBanTableSection">
      <div className="adminTableToolbar rateLimitBanToolbar">
        <span>
          <strong>{title}</strong>
          <small>{bans.length} 条</small>
        </span>
        <form action={deleteIpRateLimitBanAction}>
          {selectedKeys.map((key) => (
            <input name="rateLimitBanKeys" type="hidden" value={key} key={key} />
          ))}
          <button className="adminIconTextButton" type="submit" disabled={selectedKeys.length === 0}>
            <Trash2 size={15} aria-hidden="true" />
            删除所选
          </button>
        </form>
      </div>

      <div className="adminTableWrap rateLimitBanTableWrap">
        <table className="adminTable rateLimitBanTable">
          <thead>
            <tr>
              <th aria-label={`选择${title}`}>
                <input
                  className="adminCheckbox"
                  type="checkbox"
                  checked={allSelected}
                  disabled={entries.length === 0}
                  onChange={toggleAll}
                  aria-label={allSelected ? `取消全选${title}` : `全选${title}`}
                />
              </th>
              <th>IP 地址</th>
              <th>地区</th>
              <th>规则</th>
              <th>方式</th>
              <th>到期时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map(({ ban, key }) => (
                <tr key={key}>
                  <td>
                    <input
                      className="adminCheckbox"
                      type="checkbox"
                      checked={selectedKeys.includes(key)}
                      onChange={() => toggleOne(key)}
                      aria-label={`选择 ${ban.ip}`}
                    />
                  </td>
                  <td>
                    <code title={ban.ip}>{ban.ip}</code>
                  </td>
                  <td className="rateLimitBanCountry" title={ban.country}>{formatCountry(ban.country)}</td>
                  <td>
                    <code title={ban.ruleId}>{ban.ruleId}</code>
                  </td>
                  <td>
                    <span className={ban.permanent ? "rateLimitBanMode isPermanent" : "rateLimitBanMode isTemporary"}>
                      {ban.permanent ? "永久" : "临时"}
                    </span>
                  </td>
                  <td>{ban.bannedUntil ? <LocalDateTime value={new Date(ban.bannedUntil).toISOString()} /> : "-"}</td>
                  <td>
                    <form className="rateLimitBanDeleteForm" action={deleteIpRateLimitBanAction}>
                      <input name="rateLimitBanKeys" type="hidden" value={key} />
                      <button className="rateLimitBanDeleteButton" type="submit" aria-label={`解除 ${ban.ip} 的${title}`} title="解除封禁">
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>暂无封禁记录。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
