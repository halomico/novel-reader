"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function AdminMessageLink({ unreadCount, active }: { unreadCount: number; active: boolean }) {
  const [readThrough, setReadThrough] = useState(active ? unreadCount : 0);
  const showUnread = unreadCount > readThrough && !active;

  useEffect(() => {
    if (active) {
      setReadThrough((current) => Math.max(current, unreadCount));
    }
  }, [active, unreadCount]);

  const label = showUnread
    ? `站务消息，${unreadCount} 条未读`
    : "站务消息";

  return (
    <Link
      className={active ? "iconLink adminMessageLink isActive" : "iconLink adminMessageLink"}
      href="/admin/station"
      aria-label={label}
      title={label}
      onClick={() => setReadThrough(unreadCount)}
    >
      <MessageCircle size={18} aria-hidden="true" />
      {showUnread ? <span className="adminUnreadDot" aria-hidden="true" /> : null}
    </Link>
  );
}
