"use client";

import { CupSoda, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function MediaDownloadButton({
  mediaId,
  title,
  sizeLabel,
  price,
  initialSodaBalance,
  initiallyAvailable,
  initialAccessExpiresAt,
  admin,
}: {
  mediaId: number;
  title: string;
  sizeLabel: string;
  price: number;
  initialSodaBalance: number;
  initiallyAvailable: boolean;
  initialAccessExpiresAt: number | null;
  admin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(initiallyAvailable || admin);
  const [accessExpiresAt, setAccessExpiresAt] = useState(initialAccessExpiresAt);
  const [sodaBalance, setSodaBalance] = useState(initialSodaBalance);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const normalizedPrice = Math.max(Math.floor(price || 0), 0);
  const accessActive = available && (accessExpiresAt === null || accessExpiresAt > Date.now());

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function startDownload(url = `/media/${mediaId}/download`) {
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function confirmDownload() {
    if (pending) return;
    if (admin) {
      startDownload();
      setOpen(false);
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/media/${mediaId}/download`, { method: "POST" });
      const result = await response.json() as {
        ok?: boolean;
        message?: string;
        sodaBalance?: number;
        ticketExpiresAt?: number | null;
        downloadUrl?: string;
      };
      if (!response.ok || !result.ok) {
        setMessage(result.message || "暂时无法下载，请稍后重试");
        return;
      }
      setAvailable(true);
      setAccessExpiresAt(result.ticketExpiresAt ?? null);
      if (Number.isFinite(result.sodaBalance)) setSodaBalance(Math.max(Math.floor(result.sodaBalance!), 0));
      startDownload(result.downloadUrl || `/media/${mediaId}/download`);
      setOpen(false);
    } catch {
      setMessage("网络异常，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="mediaDownloadControl">
      <button type="button" aria-label={`下载 ${title}`} title="下载" onClick={() => { setMessage(""); setOpen(true); }}>
        <Download size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mediaDownloadBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="mediaDownloadDrawer" role="dialog" aria-modal="true" aria-labelledby="media-download-title">
            <span className="mediaDownloadHandle" aria-hidden="true" />
            <header>
              <div>
                <strong id="media-download-title">下载视频</strong>
                <small>{title}</small>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="关闭" title="关闭">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="mediaDownloadBody">
              <dl>
                <div><dt>文件大小</dt><dd>{sizeLabel}</dd></div>
                <div>
                  <dt>下载价格</dt>
                  <dd>{admin || accessActive ? "无需支付" : <><CupSoda size={15} aria-hidden="true" />{normalizedPrice}</>}</dd>
                </div>
                {!admin ? <div><dt>当前余额</dt><dd><CupSoda size={15} aria-hidden="true" />{sodaBalance}</dd></div> : null}
              </dl>
              {message ? <p className="mediaDownloadError" role="alert">{message}</p> : null}
            </div>
            <footer>
              <button className="isSecondary" type="button" onClick={() => setOpen(false)}>取消</button>
              <button type="button" disabled={pending} onClick={confirmDownload}>
                下载
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </span>
  );
}
