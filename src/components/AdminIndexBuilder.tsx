"use client";

import { Plus } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentJobSnapshot } from "@/lib/content-jobs";

type AdminIndexBuilderProps = {
  autoMaxSegments: number;
  manualLimitEnabled: boolean;
  manualMaxSegments: number;
  showProgressBars: boolean;
};

type IndexApiResponse = {
  ok: boolean;
  message?: string;
  job?: ContentJobSnapshot;
  jobId?: string;
  showProgressBars?: boolean;
};

const ACTIVE_INDEX_JOB_KEY = "novel-admin-active-index-job";
const INVALID_INDEX_TERM_PATTERN = /[\s\p{P}\p{S}]/u;

function parseIndexTerms(value: string): { ok: true; terms: string[] } | { ok: false; message: string } {
  const rawTerms = value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const invalidTerm = rawTerms.find((term) => INVALID_INDEX_TERM_PATTERN.test(term));
  if (invalidTerm) {
    return { ok: false, message: `索引词“${invalidTerm}”不能包含空格、标点或符号` };
  }

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of rawTerms) {
    const normalized = term.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      terms.push(term);
    }
  }

  return terms.length ? { ok: true, terms } : { ok: false, message: "请输入索引关键词" };
}

function IndexProgress({
  job,
  showProgressBars,
  onCancel,
}: {
  job: ContentJobSnapshot | null;
  showProgressBars: boolean;
  onCancel: () => void;
}) {
  if (!job) {
    return null;
  }

  const canCancel = job.status === "running" || job.status === "queued";

  return (
    <section className="contentProgressPanel adminIndexProgress" aria-live="polite">
      <div className="contentProgressHeader">
        <span>{job.message}</span>
        <span className="adminIndexProgressActions">
          {showProgressBars ? <strong>{job.progress}%</strong> : null}
          {canCancel ? (
            <button type="button" onClick={onCancel}>
              取消
            </button>
          ) : null}
        </span>
      </div>
      {showProgressBars ? (
        <div className="contentProgressTrack" aria-label="索引进度">
          <span style={{ width: `${job.progress}%` }} />
        </div>
      ) : null}
      <p>
        已扫描 {job.scannedBooks} / {job.totalBooks || 0} 本，命中 {job.segmentCount} 个片段
      </p>
      {job.error ? <p className="searchMessage">{job.error}</p> : null}
    </section>
  );
}

export function AdminIndexBuilder({ autoMaxSegments, manualLimitEnabled, manualMaxSegments, showProgressBars }: AdminIndexBuilderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [terms, setTerms] = useState("");
  const [job, setJob] = useState<ContentJobSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(showProgressBars);
  const [activeJobId, setActiveJobId] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const storedJobId = window.localStorage.getItem(ACTIVE_INDEX_JOB_KEY);
    if (storedJobId) {
      setActiveJobId(storedJobId);
      setIsRunning(true);
      poll(storedJobId).catch((error) => {
        window.localStorage.removeItem(ACTIVE_INDEX_JOB_KEY);
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
    window.localStorage.removeItem(ACTIVE_INDEX_JOB_KEY);
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
          setMessage(error instanceof Error ? error.message : "索引失败");
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

  async function submitIndex(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) {
      return;
    }
    const parsed = parseIndexTerms(terms);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return;
    }

    setIsRunning(true);
    setMessage("");
    setJob(null);
    try {
      const response = await fetch("/admin/indexes/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: parsed.terms }),
      });
      const data = (await response.json()) as IndexApiResponse;
      if (!response.ok || !data.ok || !data.jobId || !data.job) {
        throw new Error(data.message || "索引启动失败");
      }
      window.localStorage.setItem(ACTIVE_INDEX_JOB_KEY, data.jobId);
      setActiveJobId(data.jobId);
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
      poll(data.jobId).catch((error) => {
        setMessage(error instanceof Error ? error.message : "索引失败");
        setIsRunning(false);
      });
      setTerms("");
      inputRef.current?.focus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "索引启动失败");
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
      if (data.job.status !== "running" && data.job.status !== "queued") {
        setIsRunning(false);
        setMessage(data.job.message);
        clearActiveJob();
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "索引任务取消失败");
    }
  }

  return (
    <>
      <form className="adminIndexForm" onSubmit={submitIndex}>
        <label>
          <span>批量添加索引词</span>
          <textarea
            ref={inputRef}
            name="terms"
            rows={4}
            placeholder={"一行一个词，或用英文逗号分隔\n例如：修仙\n女帝\n系统"}
            value={terms}
            disabled={isRunning}
            onChange={(event) => setTerms(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!terms.trim() || isRunning}>
          <Plus size={16} aria-hidden="true" />
          {isRunning ? "处理中" : "批量添加"}
        </button>
      </form>
      <p className="adminInlineMessage">
        前台自动缓存超过 {autoMaxSegments} 个片段会跳过；后台手动索引{manualLimitEnabled ? `超过 ${manualMaxSegments} 个片段会跳过` : "不受片段数量限制"}。
      </p>
      {message ? <p className="adminUploadStatus">{message}</p> : null}
      <IndexProgress job={job} showProgressBars={displayProgress} onCancel={cancelJob} />
    </>
  );
}
