"use client";

import { DatabaseZap, RefreshCw, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalDateTime } from "@/components/LocalDateTime";
import type { ContentJobSnapshot } from "@/lib/content-jobs";
import type { ContentSearchSourceSummary } from "@/lib/content-search-sources";

type AdminSearchIndexManagerProps = {
  showProgressBars: boolean;
  sources: ContentSearchSourceSummary[];
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

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

const stateLabels: Record<ContentSearchSourceSummary["state"], string> = {
  disabled: "轻量书库",
  missing: "未构建",
  pending: "待更新",
  ready: "已就绪",
  failed: "存在失败",
};

export function AdminSearchIndexManager({ showProgressBars, sources }: AdminSearchIndexManagerProps) {
  const router = useRouter();
  const [job, setJob] = useState<ContentJobSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [clearingSourceId, setClearingSourceId] = useState(0);
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
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function clearActiveJob() {
    removeActiveJobId();
    setActiveJobId("");
  }

  async function poll(jobId: string) {
    const response = await fetch(`/admin/indexes/job?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const data = (await response.json()) as IndexApiResponse;
    if (!response.ok || !data.ok || !data.job) throw new Error(data.message || "索引任务状态读取失败");
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

  async function startIndex(force: boolean, source?: ContentSearchSourceSummary) {
    if (isRunning || clearingSourceId) return;
    const target = source ? source.name : "所有普通书库";
    if (force && !window.confirm(`完整重建会清空并重新生成${target}的索引；期间对应全文搜索暂不可用，确定继续吗？`)) return;
    setIsRunning(true);
    setMessage("");
    setJob(null);
    try {
      const response = await fetch("/admin/indexes/job", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ force, sourceId: source?.sourceId }),
      });
      const data = (await response.json()) as IndexApiResponse;
      if (!response.ok || !data.ok || !data.jobId || !data.job) throw new Error(data.message || "索引任务启动失败");
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
    if (!activeJobId) return;
    setMessage("");
    try {
      const response = await fetch(`/admin/indexes/job?id=${encodeURIComponent(activeJobId)}`, { method: "DELETE" });
      const data = (await response.json()) as IndexApiResponse;
      if (!response.ok || !data.ok || !data.job) throw new Error(data.message || "索引任务取消失败");
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "索引任务取消失败");
    }
  }

  async function clearIndex(source: ContentSearchSourceSummary) {
    if (isRunning || clearingSourceId || !window.confirm(`删除后，${source.name}在重新构建完成前不提供全文搜索。确定删除该分片吗？`)) return;
    setClearingSourceId(source.sourceId);
    setMessage("");
    try {
      const response = await fetch("/admin/indexes/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ action: "clear", sourceId: source.sourceId }),
      });
      const data = (await response.json()) as IndexApiResponse;
      if (!response.ok || !data.ok) throw new Error(data.message || "全文索引删除失败");
      setJob(null);
      setMessage(data.message || "全文索引已删除");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "全文索引删除失败");
    } finally {
      setClearingSourceId(0);
    }
  }

  const canCancel = job?.status === "running" || job?.status === "queued";
  const fullTextSources = sources.filter((source) => source.mode === "full");

  return (
    <section className="adminSearchIndexManager" aria-label="全文索引操作">
      <div className="adminSearchIndexActions">
        <button className="adminIconTextButton adminIndexCommand" type="button" disabled={isRunning || Boolean(clearingSourceId) || !fullTextSources.length} onClick={() => startIndex(false)}>
          <RefreshCw size={15} aria-hidden="true" />全部增量构建
        </button>
        <button className="adminIconTextButton adminIndexCommand" type="button" disabled={isRunning || Boolean(clearingSourceId) || !fullTextSources.length} onClick={() => startIndex(true)}>
          <RotateCcw size={15} aria-hidden="true" />全部完整重建
        </button>
        {canCancel ? (
          <button className="adminIconTextButton adminIndexCommand" type="button" onClick={cancelJob}>
            <Square size={14} aria-hidden="true" />取消
          </button>
        ) : null}
      </div>

      {job ? (
        <div className="contentProgressPanel adminIndexProgress" aria-live="polite">
          <div className="contentProgressHeader">
            <span>{job.message}</span>
            {displayProgress ? <strong>{job.progress}%</strong> : null}
          </div>
          {displayProgress ? <div className="contentProgressTrack" aria-label="索引进度"><span style={{ width: `${job.progress}%` }} /></div> : null}
          <p>已处理 {job.scannedBooks} / {job.totalBooks || 0} 本，更新 {job.indexedBooks}，复用 {job.reusedBooks}，失败 {job.failedBooks}</p>
          {job.error ? <p className="searchMessage">{job.error}</p> : null}
        </div>
      ) : null}
      {message && message !== job?.message ? <p className="adminUploadStatus">{message}</p> : null}

      <div className="adminIndexSourceList">
        {sources.map((source) => (
          <article className={`adminIndexSourceCard is-${source.state}`} key={source.sourceId}>
            <header>
              <div>
                <strong>{source.slug === "default" ? "默认书库" : source.name}</strong>
                <small>source-{source.sourceId}.db</small>
              </div>
              <span className={`adminIndexState is-${source.state}`}>{stateLabels[source.state]}</span>
            </header>
            <div className="adminIndexSourceStats">
              <span>覆盖 <strong>{source.indexedBooks} / {source.totalBooks}</strong></span>
              <span>待更新 <strong>{source.pendingBooks}</strong></span>
              <span>失败 <strong>{source.failedBooks}</strong></span>
              <span>索引 <strong>{formatBytes(source.databaseBytes)}</strong></span>
            </div>
            <footer>
              <span>最近完成：<LocalDateTime value={source.lastIndexedAt} /></span>
              {source.mode === "full" ? (
                <div className="adminIndexSourceActions">
                  <button type="button" disabled={isRunning || Boolean(clearingSourceId)} onClick={() => startIndex(false, source)} title={`增量构建 ${source.name}`}><RefreshCw size={14} aria-hidden="true" /></button>
                  <button type="button" disabled={isRunning || Boolean(clearingSourceId)} onClick={() => startIndex(true, source)} title={`完整重建 ${source.name}`}><RotateCcw size={14} aria-hidden="true" /></button>
                  <button className="isDanger" type="button" disabled={isRunning || Boolean(clearingSourceId) || source.databaseBytes === 0} onClick={() => clearIndex(source)} title={`删除 ${source.name} 索引`}><DatabaseZap size={14} aria-hidden="true" /></button>
                </div>
              ) : <span>仅保留本书搜索，不占用全文索引空间</span>}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
