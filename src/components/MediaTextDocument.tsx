"use client";

import { FileText, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type Preview = {
  format: "text" | "markdown";
  content: string;
  truncated: boolean;
};

export function MediaTextDocument({ mediaId }: { mediaId: number }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/media/${mediaId}/preview`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "此文件不支持在线预览" : "预览加载失败");
        return await response.json() as Preview;
      })
      .then(setPreview)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "预览加载失败");
      });
    return () => controller.abort();
  }, [mediaId]);

  if (error) {
    return <p className="mediaTextPreviewState"><FileText size={17} aria-hidden="true" />{error}</p>;
  }
  if (!preview) {
    return <p className="mediaTextPreviewState"><LoaderCircle className="isSpinning" size={17} aria-hidden="true" />正在加载预览</p>;
  }
  return (
    <div className={`mediaTextDocument is-${preview.format}`}>
      {preview.format === "markdown"
        ? <ReactMarkdown>{preview.content}</ReactMarkdown>
        : <pre>{preview.content}</pre>}
      {preview.truncated ? <p className="mediaTextTruncated">仅预览前 2 MB，下载后查看完整内容。</p> : null}
    </div>
  );
}
