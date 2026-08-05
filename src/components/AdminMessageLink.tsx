"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function AdminMessageLink({ unreadCount, active }: { unreadCount: number; active: boolean }) {
  const shouldShowUnread = unreadCount > 0 && !active;
  const [showUnread, setShowUnread] = useState(shouldShowUnread);

  useEffect(() => {
    setShowUnread(shouldShowUnread);
  }, [shouldShowUnread]);

  const label = unreadCount > 0 && !active
    ? `站务消息，${unreadCount} 条未读`
    : "站务消息";

  return (
    <Link
      className={active ? "iconLink adminMessageLink isActive" : "iconLink adminMessageLink"}
      href="/admin/station"
      aria-label={label}
      title={label}
      onClick={() => setShowUnread(false)}
    >
      <MessageCircle size={18} aria-hidden="true" />
      {showUnread ? <span className="adminUnreadDot" aria-hidden="true" /> : null}
    </Link>
  );
}
