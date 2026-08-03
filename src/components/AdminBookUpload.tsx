"use client";

import { FolderCog, Upload } from "lucide-react";
import Link from "next/link";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NovelSource } from "@/lib/novel-library";
import { AdminSelect } from "./AdminSelect";

type UploadSummary = {
  saved: number;
  duplicates: number;
  skipped: number;
  processed: number;
};

const BATCH_SIZE = 50;

export function AdminBookUpload({
  sources,
  initialSourceId,
}: {
  sources: NovelSource[];
  initialSourceId?: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"single" | "chapters">("single");
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [sourceId, setSourceId] = useState(String(
    initialSourceId || sources.find((source) => source.slug === "default")?.id || sources[0]?.id || "",
  ));
  const [novelTitle, setNovelTitle] = useState("");
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<UploadSummary>({ saved: 0, duplicates: 0, skipped: 0, processed: 0 });

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    setFiles(selectedFiles);
    setSummary({ saved: 0, duplicates: 0, skipped: 0, processed: 0 });
    setMessage(selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : "");
  }

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || isUploading) {
      return;
    }

    setIsUploading(true);
    setSummary({ saved: 0, duplicates: 0, skipped: 0, processed: 0 });

    try {
      if (mode === "chapters") {
        setMessage(`正在上传 ${files.length} 个章节`);
        const formData = new FormData();
        formData.set("mode", "chapters");
        formData.set("title", novelTitle);
        formData.set("sourceId", sourceId);
        for (const file of files) formData.append("files", file);
        const response = await fetch("/admin/books/upload", { method: "POST", body: formData });
        const data = await response.json().catch(() => ({ message: "上传接口返回异常" })) as {
          id?: number;
          chapters?: number;
          message?: string;
        };
        if (!response.ok || !data.id) throw new Error(data.message || "章节小说上传失败");
        setMessage(`已创建《${novelTitle.trim()}》，共 ${data.chapters || files.length} 章`);
        router.push(`/admin/books/${data.id}/chapters?notice=${encodeURIComponent("章节小说已创建")}&tone=success`);
        return;
      }

      let nextSummary: UploadSummary = { saved: 0, duplicates: 0, skipped: 0, processed: 0 };
      for (let index = 0; index < files.length; index += BATCH_SIZE) {
        const batch = files.slice(index, index + BATCH_SIZE);
        setMessage(`正在上传 ${Math.min(index + batch.length, files.length)} / ${files.length}`);
        const result = await uploadBatch(batch);
        nextSummary = {
          saved: nextSummary.saved + result.saved,
          duplicates: nextSummary.duplicates + result.duplicates,
          skipped: nextSummary.skipped + result.skipped,
          processed: nextSummary.processed + result.processed,
        };
        setSummary(nextSummary);
      }

      setMessage(`上传完成：新增 ${nextSummary.saved} 本，重复 ${nextSummary.duplicates} 本，跳过 ${nextSummary.skipped} 个`);
      setFiles([]);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  }

  async function uploadBatch(batch: File[]) {
    const formData = new FormData();
    formData.set("sourceId", sourceId);
    for (const file of batch) {
      formData.append("files", file);
    }

    const response = await fetch("/admin/books/upload", {
      method: "POST",
      body: formData,
    });
    let data: Partial<UploadSummary> & { message?: string } = {};
    try {
      data = (await response.json()) as Partial<UploadSummary> & { message?: string };
    } catch {
      data = { message: "上传接口返回异常" };
    }
    if (!response.ok) {
      throw new Error(data.message || "上传失败");
    }
    return {
      saved: data.saved || 0,
      duplicates: data.duplicates || 0,
      skipped: data.skipped || 0,
      processed: data.processed || batch.length,
    };
  }

  return (
    <form className={`adminUploadForm adminNovelUploadForm is-${mode}`} onSubmit={submitUpload}>
      <div className="adminNovelUploadMode" role="group" aria-label="上传类型">
        <button className={mode === "single" ? "isActive" : ""} type="button" onClick={() => setMode("single")}>单文件</button>
        <button className={mode === "chapters" ? "isActive" : ""} type="button" onClick={() => setMode("chapters")}>章节小说</button>
      </div>
      {mode === "chapters" ? (
        <label className="adminNovelUploadTitle">
          <span>小说名称</span>
          <input value={novelTitle} onChange={(event) => setNovelTitle(event.target.value)} maxLength={120} placeholder="输入小说名称" required />
        </label>
      ) : null}
      <label className="siteIconFileField adminNovelFileField">
        <span>{mode === "chapters" ? "章节文件" : "小说文件"}</span>
        <input ref={inputRef} name="files" type="file" accept=".txt,text/plain" multiple onChange={chooseFiles} disabled={isUploading} />
        <small>{mode === "chapters" ? "TXT，可多选；按文件名自然排序" : "TXT，可多选；选择后点击上传"}</small>
      </label>
      <div className="adminNovelUploadSourceGroup">
        <label className="adminNovelUploadSource">
          <span>书库</span>
          <AdminSelect value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={isUploading}>
            {sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
          </AdminSelect>
        </label>
        <Link className="adminNovelSourceManageLink" href="/admin/books/sources" title="管理书库" aria-label="管理书库">
          <FolderCog size={15} aria-hidden="true" />
        </Link>
      </div>
      <button className="adminMediaUploadButton" type="submit" disabled={
        !files.length || !sourceId || isUploading || (mode === "chapters" && !novelTitle.trim())
      }>
        <Upload size={16} aria-hidden="true" />
        {isUploading ? "上传中" : "上传"}
      </button>
      {message ? (
        <p className="adminUploadStatus" aria-live="polite">
          {message}
          {isUploading ? `，已处理 ${summary.processed} 个` : ""}
        </p>
      ) : null}
    </form>
  );
}
