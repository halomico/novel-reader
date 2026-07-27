"use client";

import { ImagePlus, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MediaVideoPreview } from "./MediaVideoPreview";

type PreparationStatus = "ready" | "pending" | "processing" | "failed";

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

export function AdminMediaCoverManager({
  mediaId,
  coverVersion,
  singlePercent,
  custom,
  preparationStatus,
  preparationError,
}: {
  mediaId: number;
  coverVersion: string;
  singlePercent: number;
  custom: boolean;
  preparationStatus: PreparationStatus;
  preparationError?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pendingAction, setPendingAction] = useState<"upload" | "restore" | "retry" | null>(null);
  const [notice, setNotice] = useState("");
  const statusLabel = custom
    ? preparationStatus === "failed" ? "自定义 · 元数据异常" : "自定义"
    : preparationStatus === "ready" ? "自动"
      : preparationStatus === "failed" ? "准备失败"
        : "准备中";

  async function upload() {
    if (!file || pendingAction) return;
    setPendingAction("upload");
    setNotice("");
    try {
      const formData = new FormData();
      formData.set("cover", file);
      const response = await fetch(`/admin/media/${mediaId}/cover`, {
        method: "POST",
        body: formData,
      });
      const message = await responseMessage(response, response.ok ? "封面已更新" : "封面上传失败");
      if (!response.ok) throw new Error(message);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setNotice(message);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "封面上传失败");
    } finally {
      setPendingAction(null);
    }
  }

  async function runAction(action: "restore" | "retry") {
    if (pendingAction) return;
    setPendingAction(action);
    setNotice("");
    try {
      const response = await fetch(
        action === "restore" ? `/admin/media/${mediaId}/cover` : `/admin/media/${mediaId}/prepare`,
        { method: action === "restore" ? "DELETE" : "POST" },
      );
      const message = await responseMessage(
        response,
        response.ok ? action === "restore" ? "已恢复自动封面" : "已重新加入准备队列" : "操作失败",
      );
      if (!response.ok) throw new Error(message);
      setNotice(message);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="adminMediaCoverManager" aria-label="视频封面">
      <div className="adminMediaCoverPreview">
        <MediaVideoPreview
          id={mediaId}
          singlePercent={singlePercent}
          sourceVersion={0}
          coverVersion={coverVersion}
          admin
        />
      </div>
      <div className="adminMediaCoverBody">
        <header>
          <div>
            <strong>视频封面</strong>
            <span className={`adminMediaCoverStatus is-${preparationStatus}`}>{statusLabel}</span>
          </div>
          {preparationStatus === "failed" && preparationError ? <small title={preparationError}>{preparationError}</small> : null}
        </header>
        <div className="adminMediaCoverActions">
          <label className="adminSecondaryButton" title="支持 JPG、PNG、WebP，最大 10 MB">
            <ImagePlus size={16} aria-hidden="true" />
            <span>{file ? file.name : "选择封面"}</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={Boolean(pendingAction)}
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setNotice("");
              }}
            />
          </label>
          <button type="button" disabled={!file || Boolean(pendingAction)} onClick={upload}>
            <Upload size={16} aria-hidden="true" />
            {pendingAction === "upload" ? "上传中" : "上传"}
          </button>
          {custom ? (
            <button
              className="adminSecondaryButton"
              type="button"
              disabled={Boolean(pendingAction)}
              onClick={() => runAction("restore")}
            >
              <RotateCcw size={16} aria-hidden="true" />
              恢复自动
            </button>
          ) : null}
          {preparationStatus === "failed" ? (
            <button
              className="adminSecondaryButton"
              type="button"
              disabled={Boolean(pendingAction)}
              onClick={() => runAction("retry")}
            >
              <RefreshCw size={16} aria-hidden="true" />
              重试
            </button>
          ) : null}
        </div>
        {notice ? <p className="adminMediaCoverNotice" role="status">{notice}</p> : null}
      </div>
    </section>
  );
}
