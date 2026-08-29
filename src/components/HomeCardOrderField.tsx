"use client";

import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  File,
  Headphones,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import {
  normalizeHomePortalOrder,
  type HomePortalCardKey,
} from "@/lib/home-portal";

const CARD_DETAILS: Record<HomePortalCardKey, { label: string; icon: LucideIcon }> = {
  announcement: { label: "公告", icon: Bell },
  novels: { label: "小说", icon: BookOpen },
  tags: { label: "标签", icon: Tags },
  video: { label: "视频", icon: Clapperboard },
  audio: { label: "音频", icon: Headphones },
  file: { label: "文件", icon: File },
};

export function HomeCardOrderField({ initialOrder }: { initialOrder: HomePortalCardKey[] }) {
  const [order, setOrder] = useState(() => normalizeHomePortalOrder(initialOrder));

  function move(index: number, offset: -1 | 1) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  return (
    <div className="adminHomeCardOrder">
      <input name="homePortalOrder" type="hidden" value={order.join(",")} readOnly />
      <div className="adminHomeCardOrderHeading">
        <strong>首页卡片顺序</strong>
        <small>使用箭头调整</small>
      </div>
      <div className="adminHomeCardOrderList">
        {order.map((key, index) => {
          const details = CARD_DETAILS[key];
          const Icon = details.icon;
          return (
            <div className="adminHomeCardOrderRow" key={key}>
              <span>
                <Icon size={15} aria-hidden="true" />
                {details.label}
              </span>
              <div>
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`上移${details.label}`}
                  title="上移"
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={index === order.length - 1}
                  aria-label={`下移${details.label}`}
                  title="下移"
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
