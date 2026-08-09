"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { FormEvent, useState, useTransition } from "react";
import { createRegistrationInvitesAction } from "@/app/admin/users/invites/actions";

export function AdminInviteGenerator() {
  const [pending, startTransition] = useTransition();
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createRegistrationInvitesAction({
        label: String(data.get("label") || ""),
        count: Number(data.get("count")),
        maxUses: Number(data.get("maxUses")),
        expiresAt: String(data.get("expiresAt") || ""),
      });
      if (result.ok) {
        setCodes(result.codes);
        setMessage(`已生成 ${result.codes.length} 个邀请码，仅在这里显示一次。`);
      } else {
        setCodes([]);
        setMessage(result.message);
      }
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <div className="adminMarketCodeTool">
      <form onSubmit={submit}>
        <label><span>备注</span><input name="label" maxLength={100} /></label>
        <label><span>数量</span><input name="count" type="number" min="1" max="1000" defaultValue="10" /></label>
        <label><span>每码可用</span><input name="maxUses" type="number" min="1" max="10000" defaultValue="1" /></label>
        <label><span>有效期</span><input name="expiresAt" type="datetime-local" /></label>
        <button type="submit" disabled={pending}><KeyRound size={15} aria-hidden="true" />生成</button>
      </form>
      {message ? <p>{message}</p> : null}
      {codes.length ? (
        <div className="adminMarketCodeOutput">
          <textarea readOnly value={codes.join("\n")} rows={Math.min(codes.length + 1, 12)} />
          <button type="button" onClick={copy}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copied ? "已复制" : "复制全部"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
