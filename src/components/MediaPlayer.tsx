"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlaybackLease = {
  sessionId: string;
  token: string;
  expiresAt: number;
  mediaUrl: string;
  format: "mp4" | "hls";
};

type PlayerStatus = "idle" | "loading" | "ready" | "error";

/** Single-bitrate VOD buffers. */
function createHlsConfig() {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    startFragPrefetch: true,
    testBandwidth: true,
    backBufferLength: 30,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    maxBufferSize: 60 * 1000 * 1000,
    maxBufferHole: 0.5,
    highBufferWatchdogPeriod: 2,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 2,
    fragLoadingMaxRetry: 4,
    fragLoadingRetryDelay: 500,
    // Single rendition playlists: avoid odd sizing edge cases on desktop.
    capLevelToPlayerSize: false,
  };
}

function mediaErrorMessage(error: MediaError | null): string {
  if (!error) return "视频加载失败，请重试";
  if (error.code === 1) return "视频加载已中止，请重新播放";
  if (error.code === 2) return "视频加载时网络中断，请检查网络后重试";
  if (error.code === 3) return "视频解码失败，建议更新浏览器后重试";
  if (error.code === 4) return "当前浏览器不支持此视频格式";
  return "视频加载失败，请重试";
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
  const hlsRef = useRef<Hls | null>(null);
  const hlsNetworkRecoveryRef = useRef(0);
  const hlsMediaRecoveryRef = useRef(0);
  const sourceLoadAttemptedRef = useRef(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"mp4" | "hls">("mp4");
  const [playbackAllowed, setPlaybackAllowed] = useState(initialPlaybackAllowed);
  const [accessExpiresAt, setAccessExpiresAt] = useState(initialAccessExpiresAt);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
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

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const clearSource = useCallback(() => {
    destroyHls();
    setSourceUrl("");
    setSourceFormat("mp4");
  }, [destroyHls]);

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

  const acquireLease = useCallback(async (): Promise<PlaybackLease> => {
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
      format?: "mp4" | "hls";
    };
    if (!response.ok || !body.sessionId || !body.token || !body.expiresAt || !body.mediaUrl) {
      throw new Error(body.message || "暂时无法开始播放");
    }
    return {
      sessionId: body.sessionId,
      token: body.token,
      expiresAt: body.expiresAt,
      mediaUrl: body.mediaUrl,
      format: body.format === "hls" ? "hls" : "mp4",
    };
  }, [clientId, id]);

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
    setStatus("error");
    setStatusMessage(message || "视频加载失败，请重试");
  }, [clearSource, releaseLease]);

  const startPlayback = useCallback(async () => {
    releaseLease();
    clearSource();
    hlsNetworkRecoveryRef.current = 0;
    hlsMediaRecoveryRef.current = 0;
    setStatus("loading");
    setStatusMessage("正在准备播放…");
    try {
      await ensurePlaybackAccess();
      if (!leaseRequired) {
        const url = `${mediaBasePath}/stream?v=${String(Math.floor(sourceVersion))}`;
        setSourceFormat("mp4");
        setSourceUrl(url);
        setStatus("ready");
        setStatusMessage("");
        return;
      }
      const lease = await acquireLease();
      leaseRef.current = lease;
      // Prefer same-origin ticket playlist URL (like a normal native/hls.js pipeline).
      setSourceFormat(lease.format);
      setSourceUrl(lease.mediaUrl);
      setStatus("ready");
      setStatusMessage("");
    } catch (reason) {
      failPlayback(reason instanceof TypeError
        ? "网络连接异常，请检查网络后重试"
        : reason instanceof Error ? reason.message : "暂时无法开始播放");
    }
  }, [
    acquireLease,
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

    destroyHls();
    if (!sourceUrl) {
      video.removeAttribute("src");
      video.load();
      return;
    }

    let cancelled = false;
    video.pause();

    if (sourceFormat === "mp4") {
      video.src = sourceUrl;
      video.load();
      return () => {
        cancelled = true;
      };
    }

    // Prefer native HLS (Safari / iOS) when the engine can play m3u8 directly.
    const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
    if (nativeHls) {
      video.src = sourceUrl;
      video.load();
      return () => {
        cancelled = true;
      };
    }

    if (!Hls.isSupported()) {
      failPlayback("当前浏览器不支持 HLS 播放");
      return;
    }

    // Desktop Chromium / Firefox: wire hls.js into the native <video controls>.
    const hls = new Hls(createHlsConfig());
    hlsRef.current = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!cancelled) {
        setStatus("ready");
        setStatusMessage("");
      }
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || cancelled) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsNetworkRecoveryRef.current < 3) {
        hlsNetworkRecoveryRef.current += 1;
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsMediaRecoveryRef.current < 2) {
        hlsMediaRecoveryRef.current += 1;
        hls.recoverMediaError();
        return;
      }
      failPlayback("HLS 播放失败，请刷新后重试");
    });
    hls.attachMedia(video);
    hls.loadSource(sourceUrl);

    return () => {
      cancelled = true;
      hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [destroyHls, failPlayback, sourceFormat, sourceUrl]);

  useEffect(() => {
    if (sourceLoadAttemptedRef.current) return;
    if (!contentAccessible) {
      setStatus("idle");
      setStatusMessage(authenticated ? "请解锁后播放" : "登录后可以播放此视频");
      return;
    }
    if (!playbackAllowed) {
      setStatus("idle");
      setStatusMessage("请先解锁后播放");
      return;
    }
    sourceLoadAttemptedRef.current = true;
    void startPlayback();
  }, [authenticated, contentAccessible, playbackAllowed, startPlayback]);

  useEffect(() => () => {
    releaseLease();
    destroyHls();
  }, [destroyHls, releaseLease]);

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
          setStatus("error");
          setStatusMessage("播放会话已失效，请刷新后重试");
          return;
        }
        activeLease.expiresAt = body.expiresAt;
      } catch {
        // Segment CDN traffic continues; next heartbeat retries.
      }
    }, 25_000);
  }

  const poster = posterUrl || `${mediaBasePath}/thumbnail?v=${encodeURIComponent(posterVersion)}`;
  const showStatus = Boolean(statusMessage) && (status === "error" || status === "loading" || status === "idle");

  return (
    <div className="mediaVideoPlayerShell">
      <video
        ref={videoRef}
        className="mediaVideoPlayer"
        controls
        playsInline
        poster={poster}
        preload={sourceUrl ? "auto" : "metadata"}
        // hls.js owns src via attachMedia; only set attribute for mp4 / native HLS.
        src={sourceFormat === "mp4" && sourceUrl ? sourceUrl : undefined}
        onPlay={recordPlay}
        onPause={stopHeartbeat}
        onEnded={() => {
          releaseLease();
        }}
        onLoadedData={() => {
          if (status !== "error") {
            setStatus("ready");
            setStatusMessage("");
          }
        }}
        onError={(event) => {
          if (!sourceUrl) return;
          if (sourceFormat === "hls" && hlsRef.current) {
            // hls.js reports fatals on its own channel.
            return;
          }
          failPlayback(mediaErrorMessage(event.currentTarget.error));
        }}
      >
        当前浏览器无法播放这个视频。
      </video>
      {showStatus ? (
        <div className={`mediaVideoPlayerStatus is-${status}`} role={status === "error" ? "alert" : "status"}>
          <span>{statusMessage}</span>
          {status === "error" || (status === "idle" && contentAccessible && playbackAllowed) ? (
            <button
              type="button"
              className="mediaVideoPlayerRetry"
              onClick={() => {
                sourceLoadAttemptedRef.current = false;
                void startPlayback();
              }}
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
