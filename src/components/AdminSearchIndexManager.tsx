"use client";

import { DatabaseZap, RefreshCw, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentJobSnapshot } from "@/lib/content-jobs";

type AdminSearchIndexManagerProps = {
  showProgressBars: boolean;
};

type IndexApiResponse = {
  ok: boolean;
  message?: string;
  job?: ContentJobSnapshot;
  jobId?: string;
  showProgressBars?: boolean;
};

const ACTIVE_INDEX_JOB_KEY = "novel-admin-active-search-index-job";

function readActiveJobId(): string {
  try {
    return window.localStorage.getItem(ACTIVE_INDEX_JOB_KEY) || "";
  } catch {
    return "";
  }
}

function writeActiveJobId(jobId: string) {
  try {
    window.localStorage.setItem(ACTIVE_INDEX_JOB_KEY, jobId);
  } catch {
    // Polling still works for the current page when storage is unavailable.
  }
}

function removeActiveJobId() {
  try {
    window.localStorage.removeItem(ACTIVE_INDEX_JOB_KEY);
  } catch {
    // No cleanup is required when storage is unavailable.
  }
}

export function AdminSearchIndexManager({ showProgressBars }: AdminSearchIndexManagerProps) {
  const router = useRouter();
  const [job, setJob] = useState<ContentJobSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(showProgressBars);
  const [activeJobId, setActiveJobId] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const storedJobId = readActiveJobId();
    if (storedJobId) {
      setActiveJobId(storedJobId);
      setIsRunning(true);
      poll(storedJobId).catch((error) => {
        removeActiveJobId();
        setMessage(error instanceof Error ? error.message : "索引任务状态读取失败");
        setIsRunning(false);
      });
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  function clearActiveJob() {
    removeActiveJobId();
    setActiveJobId("");
  }

  async function poll(jobId: string) {
    const response = await fetch(`/admin/indexes/job?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const data = (await response.json()) as IndexApiResponse;
    if (!response.ok || !data.ok || !data.job) {
      throw new Error(data.message || "索引任务状态读取失败");
    }

    setJob(data.job);
    setDisplayProgress(data.showProgressBars ?? showProgressBars);
    if (data.job.status === "running" || data.job.status === "queued") {
      timerRef.current = setTimeout(() => {
        poll(jobId).catch((error) => {
          setMessage(error instanceof Error ? error.message : "索引任务失败");
          setIsRunning(false);
        });
      }, 700);
      return;
    }

    setIsRunning(false);
    setMessage(data.job.message);
    clearActiveJob();
    router.refresh();
  }

  async function startIndex(force: boolean) {
    if (isRunning || isClearing) {
      return;
    }
    if (force && !window.confirm("完整重建会先清空现有全文索引，确定继续吗？")) {
      return;
    }

    setIsRunning(true);
    setMessage("");
    setJob(null);
    try {
      const response = await fetch("/admin/indexes/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await response.json()) as IndexApiResponse;
      if (!response.ok || !data.ok || !data.jobId || !data.job) {
        throw new Error(data.message || "索引任务启动失败");
      }
      writeActiveJobId(data.jobId);
      setActiveJobId(data.jobId);
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
      poll(data.jobId).catch((error) => {
        setMessage(error instanceof Error ? error.message : "索引任务失败");
        setIsRunning(false);
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "索引任务启动失败");
      setIsRunning(false);
    }
  }

  async function cancelJob() {
    if (!activeJobId) {
      return;
    }

    setMessage("");
    try {
      const response = await fetch(`/admin/indexes/job?id=${encodeURIComponent(activeJobId)}`, { method: "DELETE" });
      const data = (await response.json()) as IndexApiResponse;
      if (!response.ok || !data.ok || !data.job) {
        throw new Error(data.message || "索引任务取消失败");
      }
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "索引任务取消失败");
    }
  }

  async function clearIndex() {
    if (isRunning || isClearing || !window.confirm("清空后正文搜索会回退到文件扫描，确定清空全文索引吗？")) {
      return;
    }

    setIsClearing(true);
    setMessage("");
    try {
      const response = await fetch("/admin/indexes/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const data = (await response.json()) as IndexApiResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "全文索引清空失败");
      }
      setJob(null);
      setMessage(data.message || "全文索引已清空");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "全文索引清空失败");
    } finally {
      setIsClearing(false);
    }
  }

  const canCancel = job?.status === "running" || job?.status === "queued";

  return (
    <section className="adminSearchIndexManager" aria-label="全文索引操作">
      <div className="adminSearchIndexActions">
        <button className="adminIconTextButton adminIndexCommand" type="button" disabled={isRunning || isClearing} onClick={() => startIndex(false)}>
          <RefreshCw size={15} aria-hidden="true" />
          增量构建
        </button>
        <button className="adminIconTextButton adminIndexCommand" type="button" disabled={isRunning || isClearing} onClick={() => startIndex(true)}>
          <RotateCcw size={15} aria-hidden="true" />
          完整重建
        </button>
        {canCancel ? (
          <button className="adminIconTextButton adminIndexCommand" type="button" onClick={cancelJob}>
            <Square size={14} aria-hidden="true" />
            取消
          </button>
        ) : null}
        <button className="adminIconTextButton adminIndexCommand isDanger" type="button" disabled={isRunning || isClearing} onClick={clearIndex}>
          <DatabaseZap size={15} aria-hidden="true" />
          {isClearing ? "清理中" : "清空"}
        </button>
      </div>

      {job ? (
        <div className="contentProgressPanel adminIndexProgress" aria-live="polite">
          <div className="contentProgressHeader">
            <span>{job.message}</span>
            {displayProgress ? <strong>{job.progress}%</strong> : null}
          </div>
          {displayProgress ? (
            <div className="contentProgressTrack" aria-label="索引进度">
              <span style={{ width: `${job.progress}%` }} />
            </div>
          ) : null}
          <p>
            已处理 {job.scannedBooks} / {job.totalBooks || 0} 本，更新 {job.indexedBooks}，复用 {job.reusedBooks}，失败 {job.failedBooks}
          </p>
          {job.error ? <p className="searchMessage">{job.error}</p> : null}
        </div>
      ) : null}
      {message && message !== job?.message ? <p className="adminUploadStatus">{message}</p> : null}
    </section>
  );
}
