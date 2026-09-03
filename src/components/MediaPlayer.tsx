"use client";

import Hls, { type HlsConfig } from "hls.js";
import { CupSoda, LoaderCircle, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/LocalizedLink";

type PlaybackLease = {
  sessionId: string;
  token: string;
  expiresAt: number;
  mediaUrl: string;
  format: "mp4" | "hls";
  manifest: string | null;
};

type PlayerStatus = "idle" | "loading" | "ready" | "error";

export const HLS_STALL_RECOVERY_MS = 30_000;

/** Single-bitrate VOD buffers. */
export function createHlsConfig(): Partial<HlsConfig> {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    startFragPrefetch: false,
    testBandwidth: true,
    backBufferLength: 30,
    maxBufferLength: 45,
    maxMaxBufferLength: 90,
    maxBufferSize: 60 * 1000 * 1000,
    maxBufferHole: 0.5,
    highBufferWatchdogPeriod: 2,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 2,
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 25_000,
        maxLoadTimeMs: 120_000,
        timeoutRetry: {
          maxNumRetry: 4,
          retryDelayMs: 500,
          maxRetryDelayMs: 4_000,
          backoff: "linear",
        },
        errorRetry: {
          maxNumRetry: 6,
          retryDelayMs: 1_000,
          maxRetryDelayMs: 8_000,
          backoff: "exponential",
        },
      },
    },
    // Single rendition playlists: avoid odd sizing edge cases on desktop.
    capLevelToPlayerSize: false,
  };
}

function resolveInlineHlsUris(manifest: string, baseUrl: string): string {
  const resolveUri = (value: string) => new URL(value, baseUrl).toString();
  return manifest
    .split(/\r?\n/u)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith("#")) return resolveUri(line.trim());
      return line.replace(/URI="([^"]+)"/gu, (_match, uri: string) => `URI="${resolveUri(uri)}"`);
    })
    .join("\n");
}

function mediaErrorMessage(error: MediaError | null): string {
  if (!error) return "视频加载失败，请重试";
  if (error.code === 1) return "视频加载已中止，请重新播放";
  if (error.code === 2) return "视频加载时网络中断，请检查网络后重试";
  if (error.code === 3) return "视频解码失败，建议更新浏览器后重试";
  if (error.code === 4) return "视频地址无效或暂时无法播放，请重试";
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
  const inlineManifestRef = useRef<string | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsStallTimerRef = useRef<number | null>(null);
  const hlsStallRecoveryRef = useRef(0);
  const hlsNetworkRecoveryRef = useRef(0);
  const hlsMediaRecoveryRef = useRef(0);
  const sourceLoadAttemptedRef = useRef(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"mp4" | "hls">("mp4");
  const [playbackAllowed, setPlaybackAllowed] = useState(initialPlaybackAllowed);
  const [accessExpiresAt, setAccessExpiresAt] = useState(initialAccessExpiresAt);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const mediaBasePath = useMemo(() => basePath || `/media/${id}`, [basePath, id]);
  const returnTo = useMemo(() => `/media/${id}`, [id]);
  const loginHref = useMemo(
    () => `/login?${new URLSearchParams({ returnTo }).toString()}`,
    [returnTo],
  );

  const needsLogin = !contentAccessible && !authenticated;
  const needsUnlock = contentAccessible && !playbackAllowed;
  const showAccessGate = needsLogin || needsUnlock;

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

  const clearHlsStallRecovery = useCallback(() => {
    if (hlsStallTimerRef.current != null) {
      window.clearTimeout(hlsStallTimerRef.current);
      hlsStallTimerRef.current = null;
    }
  }, []);

  const scheduleHlsStallRecovery = useCallback(() => {
    const video = videoRef.current;
    if (!video || sourceFormat !== "hls" || video.paused || video.ended || hlsStallTimerRef.current != null) {
      return;
    }
    const stalledAt = video.currentTime;
    hlsStallTimerRef.current = window.setTimeout(() => {
      hlsStallTimerRef.current = null;
      const currentVideo = videoRef.current;
      if (
        !currentVideo ||
        currentVideo.paused ||
        currentVideo.ended ||
        currentVideo.currentTime > stalledAt + 0.25 ||
        hlsStallRecoveryRef.current >= 2
      ) {
        return;
      }
      hlsStallRecoveryRef.current += 1;
      const hls = hlsRef.current;
      if (hls) {
        hls.startLoad(Math.max(0, currentVideo.currentTime), true);
      } else {
        currentVideo.pause();
      }
      void currentVideo.play().catch(() => undefined);
    }, HLS_STALL_RECOVERY_MS);
  }, [sourceFormat]);

  const destroyHls = useCallback(() => {
    clearHlsStallRecovery();
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, [clearHlsStallRecovery]);

  const clearSource = useCallback(() => {
    destroyHls();
    inlineManifestRef.current = null;
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
      headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
      body: JSON.stringify({ mediaId: id, sessionId: lease.sessionId, token: lease.token }),
      keepalive: true,
    });
  }, [id, stopHeartbeat]);

  const acquireLease = useCallback(async (): Promise<PlaybackLease> => {
    const response = await fetch("/api/media-playback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
      body: JSON.stringify({
        mediaId: id,
        clientId: clientId(),
        inlineHls: Hls.isSupported(),
      }),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      message?: string;
      sessionId?: string;
      token?: string;
      expiresAt?: number;
      mediaUrl?: string;
      format?: "mp4" | "hls";
      manifest?: unknown;
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
      manifest: typeof body.manifest === "string" && body.manifest.startsWith("#EXTM3U")
        ? body.manifest
        : null,
    };
  }, [clientId, id]);

  const ensurePlaybackAccess = useCallback(async () => {
    if (!contentAccessible) throw new Error("LOGIN_REQUIRED");
    if (playbackAllowed) {
      if (!accessExpiresAt || accessExpiresAt > Date.now()) return;
      setPlaybackAllowed(false);
      throw new Error("播放授权已到期，请重新解锁");
    }
    if (!authenticated) throw new Error("LOGIN_REQUIRED");
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
    hlsStallRecoveryRef.current = 0;
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
      inlineManifestRef.current = lease.format === "hls" ? lease.manifest : null;
      setSourceFormat(lease.format);
      setSourceUrl(lease.mediaUrl);
      setStatus("ready");
      setStatusMessage("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "暂时无法开始播放";
      if (message === "LOGIN_REQUIRED") {
        setStatus("idle");
        setStatusMessage("");
        return;
      }
      failPlayback(reason instanceof TypeError
        ? "网络连接异常，请检查网络后重试"
        : message);
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

  const handleUnlock = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    setStatusMessage("");
    try {
      sourceLoadAttemptedRef.current = false;
      await startPlayback();
    } finally {
      setUnlocking(false);
    }
  }, [startPlayback, unlocking]);

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

    // WordPress / industry default: use hls.js on Chromium/Firefox first.
    // Some Chromium builds return a non-empty canPlayType for mpegurl but still
    // cannot play m3u8 natively (MEDIA_ERR_SRC_NOT_SUPPORTED). Prefer MSE.
    if (Hls.isSupported()) {
      const hls = new Hls(createHlsConfig());
      const inlineManifest = inlineManifestRef.current;
      const hlsSource = inlineManifest
        ? URL.createObjectURL(new Blob(
          [resolveInlineHlsUris(inlineManifest, window.location.href)],
          { type: "application/vnd.apple.mpegurl" },
        ))
        : sourceUrl;
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) {
          setStatus("ready");
          setStatusMessage("");
        }
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        hlsNetworkRecoveryRef.current = 0;
        hlsMediaRecoveryRef.current = 0;
      });
      hls.on(Hls.Events.STALL_RESOLVED, () => {
        hlsStallRecoveryRef.current = 0;
        clearHlsStallRecovery();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled) return;
        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            scheduleHlsStallRecovery();
          }
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsNetworkRecoveryRef.current < 3) {
          hlsNetworkRecoveryRef.current += 1;
          hls.startLoad(Math.max(0, video.currentTime), true);
          void video.play().catch(() => undefined);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsMediaRecoveryRef.current < 2) {
          hlsMediaRecoveryRef.current += 1;
          hls.recoverMediaError();
          return;
        }
        failPlayback("HLS 播放失败，请刷新后重试");
      });
      // Recommended order for hls.js: loadSource then attachMedia.
      hls.loadSource(hlsSource);
      hls.attachMedia(video);

      return () => {
        cancelled = true;
        hls.destroy();
        if (inlineManifest) URL.revokeObjectURL(hlsSource);
        if (hlsRef.current === hls) hlsRef.current = null;
      };
    }

    // Safari / iOS: native HLS only when hls.js MSE is unavailable.
    const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
    if (nativeHls) {
      video.src = sourceUrl;
      video.load();
      return () => {
        cancelled = true;
      };
    }

    failPlayback("当前浏览器不支持 HLS 播放");
    return () => {
      cancelled = true;
    };
  }, [clearHlsStallRecovery, destroyHls, failPlayback, scheduleHlsStallRecovery, sourceFormat, sourceUrl]);

  useEffect(() => {
    if (sourceLoadAttemptedRef.current) return;
    if (!contentAccessible || !playbackAllowed) {
      setStatus("idle");
      setStatusMessage("");
      return;
    }
    sourceLoadAttemptedRef.current = true;
    void startPlayback();
  }, [contentAccessible, playbackAllowed, startPlayback]);

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
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
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
  const showStatus = Boolean(statusMessage) && status === "error" && !showAccessGate;

  return (
    <div className={`mediaVideoPlayerShell${showAccessGate ? " has-access-gate" : ""}`}>
      <video
        ref={videoRef}
        className="mediaVideoPlayer"
        controls={!showAccessGate && Boolean(sourceUrl)}
        playsInline
        poster={poster}
        preload={sourceUrl ? "auto" : "metadata"}
        // hls.js owns src via attachMedia; only set attribute for mp4 / native HLS.
        src={sourceFormat === "mp4" && sourceUrl ? sourceUrl : undefined}
        onPlay={recordPlay}
        onPlaying={() => {
          hlsStallRecoveryRef.current = 0;
          clearHlsStallRecovery();
        }}
        onTimeUpdate={() => {
          hlsStallRecoveryRef.current = 0;
          clearHlsStallRecovery();
        }}
        onWaiting={scheduleHlsStallRecovery}
        onStalled={scheduleHlsStallRecovery}
        onPause={() => {
          clearHlsStallRecovery();
          stopHeartbeat();
        }}
        onEnded={() => {
          clearHlsStallRecovery();
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

      {showAccessGate ? (
        <div className="mediaVideoAccessGate" role="region" aria-label={needsLogin ? "登录后播放" : "解锁后播放"}>
          {needsLogin ? (
            <Link className="mediaVideoAccessGateCta" href={loginHref}>
              <Play size={14} strokeWidth={2.2} aria-hidden="true" />
              登录后播放
            </Link>
          ) : (
            <button
              type="button"
              className="mediaVideoAccessGateCta"
              onClick={() => void handleUnlock()}
              disabled={unlocking}
            >
              {unlocking
                ? <LoaderCircle className="isSpinning" size={14} aria-hidden="true" />
                : <CupSoda size={14} strokeWidth={2.1} aria-hidden="true" />}
              {unlocking ? "解锁中…" : "立即解锁"}
            </button>
          )}
        </div>
      ) : null}

      {showStatus ? (
        <div className={`mediaVideoPlayerStatus is-${status}`} role={status === "error" ? "alert" : "status"}>
          <span>{statusMessage}</span>
          {status === "error" ? (
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
