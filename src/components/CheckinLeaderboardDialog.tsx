"use client";

import { LoaderCircle, Trophy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DailyCheckinLeaderboardEntry } from "@/lib/user-economy";
import { DEFAULT_LOCALE, uiText, type AppLocale } from "@/lib/locale";
import { UserAvatar } from "./UserAvatar";

type CheckinLeaderboardDialogProps = {
  reward: number;
  currentUserId: number;
  entries: DailyCheckinLeaderboardEntry[] | null;
  autoOpen: boolean;
  locale?: AppLocale;
};

export function CheckinLeaderboardDialog({
  reward,
  currentUserId,
  entries,
  autoOpen,
  locale = DEFAULT_LOCALE,
}: CheckinLeaderboardDialogProps) {
  const [open, setOpen] = useState(autoOpen);
  const [leaderboard, setLeaderboard] = useState(entries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!autoOpen) return;
    const url = new URL(window.location.href);
    for (const key of ["checkin", "notice", "tone"]) {
      url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [autoOpen]);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function showLeaderboard() {
    setOpen(true);
    if (leaderboard !== null || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/account/checkin-leaderboard", { cache: "no-store" });
      const data = await response.json() as {
        entries?: DailyCheckinLeaderboardEntry[];
        message?: string;
      };
      if (!response.ok || !data.entries) {
        setError(data.message || uiText(locale, "排行榜读取失败"));
        return;
      }
      setLeaderboard(data.entries);
    } catch {
      setError(uiText(locale, "排行榜读取失败"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className="accountLeaderboardButton"
        type="button"
        onClick={showLeaderboard}
        aria-label={uiText(locale, "查看今日排行榜")}
        title={uiText(locale, "今日排行榜")}
      >
        <Trophy size={16} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="checkinLeaderboardBackdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <section
            className="checkinLeaderboardDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkin-leaderboard-title"
          >
            <header>
              <div>
                <span className="checkinLeaderboardIcon" aria-hidden="true">
                  <Trophy size={18} />
                </span>
                <span>
                  <h2 id="checkin-leaderboard-title">{uiText(locale, "今日苏打榜")}</h2>
                </span>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={uiText(locale, "关闭")}
                title={uiText(locale, "关闭")}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className={`checkinReward${reward > 0 ? "" : " isPending"}`}>
              <span>{uiText(locale, reward > 0 ? "今日获得" : "今日尚未签到")}</span>
              {reward > 0 ? <><strong>+{reward}</strong><small>{uiText(locale, "苏打")}</small></> : null}
            </div>

            {loading ? (
              <p className="checkinLeaderboardStatus">
                <LoaderCircle className="isSpinning" size={17} aria-hidden="true" />
                {uiText(locale, "正在读取")}
              </p>
            ) : error ? (
              <p className="checkinLeaderboardStatus isError">{error}</p>
            ) : leaderboard?.length ? (
              <ol className="checkinLeaderboardList">
                {leaderboard.map((entry, index) => {
                  const isCurrent = entry.userId === currentUserId;
                  return (
                    <li className={isCurrent ? "isCurrent" : ""} key={entry.userId}>
                      <span className="checkinLeaderboardRank">{index + 1}</span>
                      <UserAvatar className="checkinLeaderboardAvatar" userId={entry.userId} displayName={entry.displayName} avatarPath={entry.avatarPath} />
                      <span className="checkinLeaderboardName">
                        <strong>{entry.displayName}</strong>
                        {isCurrent ? <small>{uiText(locale, "我")}</small> : null}
                      </span>
                      <b>+{entry.reward}</b>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="checkinLeaderboardStatus">{uiText(locale, "今天还没有签到记录")}</p>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
