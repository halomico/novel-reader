"use client";

import { Upload } from "lucide-react";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type UploadSummary = {
  saved: number;
  duplicates: number;
  skipped: number;
  processed: number;
};

const BATCH_SIZE = 50;

export function AdminBookUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<UploadSummary>({ saved: 0, duplicates: 0, skipped: 0, processed: 0 });

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    setFiles(selectedFiles);
    setSummary({ saved: 0, duplicates: 0, skipped: 0, processed: 0 });
    setMessage(selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : "");
  }

  async function uploadBatch(batch: File[]) {
    const formData = new FormData();
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

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || isUploading) {
      return;
    }

    setIsUploading(true);
    setSummary({ saved: 0, duplicates: 0, skipped: 0, processed: 0 });

    try {
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

  return (
    <form className="adminUploadForm" onSubmit={submitUpload}>
      <label>
        <Upload size={18} aria-hidden="true" />
        <span>添加小说</span>
        <input ref={inputRef} name="files" type="file" accept=".txt,text/plain" multiple onChange={chooseFiles} disabled={isUploading} />
      </label>
      <button type="submit" disabled={!files.length || isUploading}>
        {isUploading ? "上传中" : "上传"}
      </button>
      {message ? (
        <p className="adminUploadStatus">
          {message}
          {isUploading ? `，已处理 ${summary.processed} 个` : ""}
        </p>
      ) : null}
    </form>
  );
}
