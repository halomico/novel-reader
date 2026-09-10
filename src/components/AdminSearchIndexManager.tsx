"use client";

import { RefreshCw, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalDateTime } from "@/components/LocalDateTime";
import type { PostgresContentIndexJobSnapshot } from "@/domains/reading/postgres-content-index-job";
import type { PostgresContentSourceStatus } from "@/domains/reading/postgres-content-status";

type AdminSearchIndexManagerProps = {
  showProgressBars: boolean;
  sources: PostgresContentSourceStatus[];
};

type IndexApiResponse = {
  ok: boolean;
  message?: string;
  job?: PostgresContentIndexJobSnapshot;
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

const stateLabels: Record<PostgresContentSourceStatus["state"], string> = {
  missing: "未构建",
  pending: "待更新",
  ready: "已就绪",
  failed: "存在失败",
};

export function AdminSearchIndexManager({ showProgressBars, sources }: AdminSearchIndexManagerProps) {
  const router = useRouter();
  const [job, setJob] = useState<PostgresContentIndexJobSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(showProgressBars);
  const [activeJobId, setActiveJobId] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    const storedJobId = readActiveJobId();
    if (storedJobId) {
      setActiveJobId(storedJobId);
      setIsRunning(true);
      poll(storedJobId).catch((error) => {
        if (!isMountedRef.current) return;
        removeActiveJobId();
        setMessage(error instanceof Error ? error.message : "索引任务状态读取失败");
        setIsRunning(false);
      });
    }
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function clearActiveJob() {
    removeActiveJobId();
    setActiveJobId("");
  }

  async function poll(jobId: string) {
    if (!isMountedRef.current) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/admin/indexes/job?id=${encodeURIComponent(jobId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json()) as IndexApiResponse;
      if (!isMountedRef.current) return;
      if (!response.ok || !data.ok || !data.job) throw new Error(data.message || "索引任务状态读取失败");
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
      if (data.job.status === "running" || data.job.status === "queued") {
        timerRef.current = setTimeout(() => {
          if (!isMountedRef.current) return;
          poll(jobId).catch((error) => {
            if (!isMountedRef.current) return;
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
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      throw error;
    }
  }

  async function startIndex(force: boolean, source?: PostgresContentSourceStatus) {
    if (isRunning) return;
    const target = source ? source.name : "全部书库";
    if (force && !window.confirm(`将为${target}在线生成新的 PostgreSQL 正文分代；当前已发布内容会持续可用。确定开始吗？`)) return;
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
        if (!isMountedRef.current) return;
        setMessage(error instanceof Error ? error.message : "索引任务失败");
        setIsRunning(false);
      });
    } catch (error) {
      if (!isMountedRef.current) return;
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
      if (!isMountedRef.current) return;
      if (!response.ok || !data.ok || !data.job) throw new Error(data.message || "索引任务取消失败");
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
    } catch (error) {
      if (!isMountedRef.current) return;
      setMessage(error instanceof Error ? error.message : "索引任务取消失败");
    }
  }

  const canCancel = job?.status === "running" || job?.status === "queued";
  const fullTextSources = sources.filter((source) => source.mode === "full");

  return (
    <section className="adminSearchIndexManager" aria-label="全文索引操作">
      <div className="adminSearchIndexActions">
        <button className="adminIconTextButton adminIndexCommand" type="button" disabled={isRunning || !fullTextSources.length} onClick={() => startIndex(false)}>
          <RefreshCw size={15} aria-hidden="true" />全部增量构建
        </button>
        <button className="adminIconTextButton adminIndexCommand" type="button" disabled={isRunning || !fullTextSources.length} onClick={() => startIndex(true)}>
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
            {displayProgress ? <strong>{job.percent}%</strong> : null}
          </div>
          {displayProgress ? <div className="contentProgressTrack" aria-label="索引进度"><span style={{ width: `${job.percent}%` }} /></div> : null}
          <p>已处理 {job.processedDocuments} / {job.totalDocuments || 0} 篇，完成 {job.indexedDocuments}，失败 {job.failedDocuments}，体积 {formatBytes(job.bytes)}</p>
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
                <small>{source.slug}</small>
              </div>
              <span className={`adminIndexState is-${source.state}`}>{stateLabels[source.state]}</span>
            </header>
            <div className="adminIndexSourceStats">
              <span>覆盖 <strong>{source.indexedBooks} / {source.totalBooks}</strong></span>
              <span>待更新 <strong>{source.pendingBooks}</strong></span>
              <span>失效 <strong>{source.staleBooks}</strong></span>
              <span>失败 <strong>{source.failedBooks}</strong></span>
              <span>正文 <strong>{formatBytes(source.sourceBytes)}</strong></span>
            </div>
            <footer>
              <span>最近完成：<LocalDateTime value={source.lastIndexedAt} /></span>
              {source.mode === "full" ? (
                <div className="adminIndexSourceActions">
                  <button type="button" disabled={isRunning} onClick={() => startIndex(false, source)} title={`增量构建 ${source.name}`}><RefreshCw size={14} aria-hidden="true" /></button>
                  <button type="button" disabled={isRunning} onClick={() => startIndex(true, source)} title={`完整重建 ${source.name}`}><RotateCcw size={14} aria-hidden="true" /></button>
                </div>
              ) : <span>仅保留本书搜索，不写入全站全文索引</span>}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}