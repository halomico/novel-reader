import { LogIn } from "lucide-react";
import Link from "@/components/LocalizedLink";

export function ContentAccessGate({
  returnTo,
  title = "登录后查看",
  description = "此内容仅向登录用户开放。",
  label = "登录后继续",
}: {
  returnTo: string;
  title?: string;
  description?: string | null;
  label?: string;
}) {
  const params = new URLSearchParams({ returnTo });
  return (
    <section className={description ? "contentAccessGate" : "contentAccessGate isCompact"} aria-label={label}>
      <span className="contentAccessGateIcon" aria-hidden="true"><LogIn size={20} /></span>
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <Link href={`/login?${params.toString()}`}>
        <LogIn size={15} aria-hidden="true" />
        {label}
      </Link>
    </section>
  );
}
