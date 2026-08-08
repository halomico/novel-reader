"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlaybackLease = {
  sessionId: string;
  token: string;
  expiresAt: number;
  mediaUrl: string;
  /** Fully rewritten m3u8 from the ticket API (preferred — no second manifest RTT). */
  manifest: string | null;
  format: "mp4" | "hls";
};

type HlsController = {
  destroy: () => void;
  recoverMediaError: () => void;
  startLoad: () => void;
};

/** Single-bitrate VOD: prefer thicker buffers over ABR thrash. */
const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  startFragPrefetch: true,
  testBandwidth: true,
  backBufferLength: 30,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  maxBufferSize: 60 * 1000 * 1000,
  maxBufferHole: 0.5,
  highBufferWatchdogPeriod: 1,
  manifestLoadingMaxRetry: 2,
  levelLoadingMaxRetry: 2,
  fragLoadingMaxRetry: 4,
  fragLoadingRetryDelay: 500,
  capLevelToPlayerSize: true,
} as const;

function mediaErrorMessage(error: MediaError | null): string {
  if (!error) return "视频加载失败，请重试";
  if (error.code === 1) return "视频加载已中止，请重新播放";
  if (error.code === 2) return "视频加载时网络中断，请检查网络后重试";
  if (error.code === 3) return "视频解码失败，建议更新 Safari 或切换浏览器";
  if (error.code === 4) return "当前浏览器不支持此视频编码或格式";
  return "视频加载失败，请重试";
}

function revokeObjectUrl(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

export function MediaPlayer({
  id,
  posterVersion,
  posterUrl,
  sourceVersion,
  basePath,
  authenticated,
  leaseRequired = true,
  initialPlaybackAllowed = true,
  initialAccessExpiresAt = null,
  contentAccessible = true,
}: {
  id: number;
  posterVersion: string;
  posterUrl?: string | null;
  sourceVersion: number;
  basePath?: string;
  authenticated: boolean;
  leaseRequired?: boolean;
  initialPlaybackAllowed?: boolean;
  initialAccessExpiresAt?: number | null;
  contentAccessible?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const countedRef = useRef(false);
  const leaseRef = useRef<PlaybackLease | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const hlsRef = useRef<HlsController | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const hlsNetworkRecoveryRef = useRef(0);
  const hlsMediaRecoveryRef = useRef(0);
  const sourceLoadAttemptedRef = useRef(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"mp4" | "hls">("mp4");
  const [playbackAllowed, setPlaybackAllowed] = useState(initialPlaybackAllowed);
  const [accessExpiresAt, setAccessExpiresAt] = useState(initialAccessExpiresAt);
  const mediaBasePath = useMemo(() => basePath || `/media/${id}`, [basePath, id]);

  const clientId = useCallback(() => {
    const key = "novel-video-client-id";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = window.crypto.randomUUID().replace(/-/g, "");
    window.sessionStorage.setItem(key, created);
    return created;
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current != null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const clearSource = useCallback(() => {
    revokeObjectUrl(blobUrlRef.current);
    blobUrlRef.current = null;
    setSourceUrl("");
    setSourceFormat("mp4");
  }, []);

  const releaseLease = useCallback(() => {
    stopHeartbeat();
    const lease = leaseRef.current;
    leaseRef.current = null;
    if (!lease) return;
    void fetch("/api/media-playback", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: id, sessionId: lease.sessionId, token: lease.token }),
      keepalive: true,
    });
  }, [id, stopHeartbeat]);

  const acquireLease = useCallback(async (): Promise<PlaybackLease | null> => {
    if (!leaseRequired) return null;
    const response = await fetch("/api/media-playback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: id, clientId: clientId() }),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      message?: string;
      sessionId?: string;
      token?: string;
      expiresAt?: number;
      mediaUrl?: string;
      manifest?: string | null;
      format?: "mp4" | "hls";
    };
    if (!response.ok || !body.sessionId || !body.token || !body.expiresAt) {
      throw new Error(body.message || "暂时无法开始播放");
    }
    const format = body.format === "hls" ? "hls" : "mp4";
    const manifest = typeof body.manifest === "string" && body.manifest.startsWith("#EXTM3U")
      ? body.manifest
      : null;
    if (format === "hls" && !manifest && !body.mediaUrl) {
      throw new Error(body.message || "暂时无法开始播放");
    }
    if (format === "mp4" && !body.mediaUrl) {
      throw new Error(body.message || "暂时无法开始播放");
    }
    return {
      sessionId: body.sessionId,
      token: body.token,
      expiresAt: body.expiresAt,
      mediaUrl: body.mediaUrl || "",
      manifest,
      format,
    };
  }, [clientId, id, leaseRequired]);

  const ensurePlaybackAccess = useCallback(async () => {
    if (!contentAccessible) throw new Error("登录后可以播放此视频");
    if (playbackAllowed) {
      if (!accessExpiresAt || accessExpiresAt > Date.now()) return;
      setPlaybackAllowed(false);
      throw new Error("播放授权已到期，请重新解锁");
    }
    if (!authenticated) throw new Error("登录后可用苏打解锁");
    const response = await fetch(`/api/media/${id}/unlock`, { method: "POST" });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      message?: string;
      expiresAt?: number | null;
    };
    if (!response.ok || !body.ok) throw new Error(body.message || "暂时无法解锁视频");
    setPlaybackAllowed(true);
    setAccessExpiresAt(body.expiresAt || null);
  }, [accessExpiresAt, authenticated, contentAccessible, id, playbackAllowed]);

  const failPlayback = useCallback((message: string) => {
    releaseLease();
    clearSource();
    if (message) console.warn(`[video:${id}] ${message}`);
  }, [clearSource, id, releaseLease]);

  const applyLeaseSource = useCallback((lease: PlaybackLease) => {
    revokeObjectUrl(blobUrlRef.current);
    blobUrlRef.current = null;
    if (lease.format === "hls" && lease.manifest) {
      const blob = new Blob([lease.manifest], { type: "application/vnd.apple.mpegurl" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setSourceFormat("hls");
      setSourceUrl(url);
      return;
    }
    setSourceFormat(lease.format);
    setSourceUrl(lease.mediaUrl || `${mediaBasePath}/stream?v=${String(Math.floor(sourceVersion))}`);
  }, [mediaBasePath, sourceVersion]);

  const startPlayback = useCallback(async () => {
    releaseLease();
    clearSource();
    hlsNetworkRecoveryRef.current = 0;
    hlsMediaRecoveryRef.current = 0;
    try {
      await ensurePlaybackAccess();
      if (!leaseRequired) {
        setSourceFormat("mp4");
        setSourceUrl(`${mediaBasePath}/stream?v=${String(Math.floor(sourceVersion))}`);
        return;
      }
      const lease = await acquireLease();
      if (!lease) {
        throw new Error("暂时无法开始播放");
      }
      leaseRef.current = lease;
      applyLeaseSource(lease);
    } catch (reason) {
      failPlayback(reason instanceof TypeError
        ? "网络连接异常，请检查网络后重试"
        : reason instanceof Error ? reason.message : "暂时无法开始播放");
    }
  }, [
    acquireLease,
    applyLeaseSource,
    clearSource,
    ensurePlaybackAccess,
    failPlayback,
    leaseRequired,
    mediaBasePath,
    releaseLease,
    sourceVersion,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (!sourceUrl) {
      video.removeAttribute("src");
      video.load();
      return;
    }

    let cancelled = false;
    video.pause();
    video.removeAttribute("src");

    if (sourceFormat === "mp4") {
      video.src = sourceUrl;
      video.load();
      return () => {
        cancelled = true;
      };
    }

    // Safari / iOS: native HLS. Blob playlists work on modern Safari; fall back to ticket URL.
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
    if (nativeHls && !Hls.isSupported()) {
      video.src = sourceUrl;
      video.load();
      video.addEventListener("error", function onNativeError() {
        video.removeEventListener("error", onNativeError);
        if (cancelled) return;
        const lease = leaseRef.current;
        if (lease?.mediaUrl && sourceUrl.startsWith("blob:")) {
          setSourceUrl(lease.mediaUrl);
        }
      }, { once: true });
      return () => {
        cancelled = true;
      };
    }

    if (!Hls.isSupported()) {
      // Native-capable browsers already handled above; remaining = unsupported.
      if (nativeHls) {
        video.src = sourceUrl;
        video.load();
        return () => {
          cancelled = true;
        };
      }
      failPlayback("当前浏览器不支持 HLS");
      return;
    }

    const hls = new Hls(HLS_CONFIG);
    hlsRef.current = hls;
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      if (!cancelled) hls.loadSource(sourceUrl);
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || cancelled) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsNetworkRecoveryRef.current < 2) {
        hlsNetworkRecoveryRef.current += 1;
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsMediaRecoveryRef.current < 1) {
        hlsMediaRecoveryRef.current += 1;
        hls.recoverMediaError();
        return;
      }
      // Blob playlist rejected → fall back to server manifest once.
      const lease = leaseRef.current;
      if (lease?.mediaUrl && sourceUrl.startsWith("blob:") && hlsNetworkRecoveryRef.current < 3) {
        hlsNetworkRecoveryRef.current += 1;
        setSourceUrl(lease.mediaUrl);
        return;
      }
      failPlayback("HLS 播放失败");
    });
    hls.attachMedia(video);

    return () => {
      cancelled = true;
      hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [failPlayback, sourceFormat, sourceUrl]);

  useEffect(() => {
    if (sourceLoadAttemptedRef.current || !contentAccessible || !playbackAllowed) return;
    sourceLoadAttemptedRef.current = true;
    void startPlayback();
  }, [contentAccessible, playbackAllowed, startPlayback]);

  useEffect(() => () => {
    releaseLease();
    revokeObjectUrl(blobUrlRef.current);
    blobUrlRef.current = null;
  }, [releaseLease]);

  function recordPlay() {
    const currentLease = leaseRef.current;
    if (currentLease && currentLease.expiresAt <= Date.now()) {
      videoRef.current?.pause();
      releaseLease();
      clearSource();
      sourceLoadAttemptedRef.current = false;
      void startPlayback();
      return;
    }
    if (!countedRef.current) {
      countedRef.current = true;
      void fetch(`${mediaBasePath}/play`, { method: "POST", keepalive: true }).catch(() => {
        countedRef.current = false;
      });
    }
    const lease = leaseRef.current;
    if (!lease || heartbeatRef.current != null) return;
    heartbeatRef.current = window.setInterval(async () => {
      const activeLease = leaseRef.current;
      const video = videoRef.current;
      if (!activeLease || !video || video.paused || video.ended) return;
      try {
        const response = await fetch("/api/media-playback", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId: id,
            sessionId: activeLease.sessionId,
            token: activeLease.token,
          }),
        });
        const body = await response.json() as { expiresAt?: number };
        if (!response.ok || !body.expiresAt) {
          video.pause();
          releaseLease();
          clearSource();
          return;
        }
        activeLease.expiresAt = body.expiresAt;
      } catch {
        // Retry on a later heartbeat; segment CDN traffic stays uninterrupted.
      }
    }, 25_000);
  }

  function handlePause() {
    stopHeartbeat();
  }

  function handleEnded() {
    releaseLease();
  }

  const poster = posterUrl || `${mediaBasePath}/thumbnail?v=${encodeURIComponent(posterVersion)}`;

  return (
    <div className="mediaVideoPlayerShell">
      <video
        ref={videoRef}
        className="mediaVideoPlayer"
        controls
        playsInline
        poster={poster}
        preload={sourceUrl ? "auto" : "none"}
        // Avoid setting src for hls.js path (attachMedia owns the element).
        src={sourceFormat === "mp4" && sourceUrl ? sourceUrl : undefined}
        onPlay={recordPlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={(event) => {
          if (!sourceUrl) return;
          if (sourceFormat === "hls") {
            const lease = leaseRef.current;
            if (lease?.mediaUrl && sourceUrl.startsWith("blob:")) {
              setSourceUrl(lease.mediaUrl);
              return;
            }
            failPlayback("HLS 播放失败");
            return;
          }
          failPlayback(mediaErrorMessage(event.currentTarget.error));
        }}
      >
        当前浏览器无法播放这个视频。
      </video>
    </div>
  );
}
