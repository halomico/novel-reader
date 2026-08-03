"use client";

import { Upload } from "lucide-react";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function AdminChapterUpload({ novelId }: { novelId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
    setMessage(selected.length ? `已选择 ${selected.length} 个章节` : "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || pending) return;
    setPending(true);
    setMessage(`正在上传 ${files.length} 个章节`);
    try {
      const formData = new FormData();
      for (const file of files) formData.append("files", file);
      const response = await fetch(`/admin/books/${novelId}/chapters/upload`, { method: "POST", body: formData });
      const data = await response.json().catch(() => ({ message: "上传接口返回异常" })) as { added?: number; message?: string };
      if (!response.ok) throw new Error(data.message || "章节上传失败");
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      setMessage(`已添加 ${data.added || 0} 个章节`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "章节上传失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="adminChapterUpload" onSubmit={submit}>
      <label className="siteIconFileField">
        <span>添加章节</span>
        <input ref={inputRef} type="file" accept=".txt,text/plain" multiple onChange={chooseFiles} disabled={pending} />
        <small>按文件名自然排序，新增章节接在目录末尾</small>
      </label>
      <button className="adminMediaUploadButton" type="submit" disabled={!files.length || pending}>
        <Upload size={15} aria-hidden="true" />{pending ? "上传中" : "上传"}
      </button>
      {message ? <p className="adminUploadStatus" aria-live="polite">{message}</p> : null}
    </form>
  );
}
