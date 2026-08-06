"use client";

import { CupSoda, LoaderCircle, LogIn, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlaybackLease = {
  sessionId: string;
  token: string;
  expiresAt: number;
  mediaUrl: string;
  fallbackMediaUrl: string;
  format: "mp4" | "hls";
};

type HlsController = {
  destroy: () => void;
  recoverMediaError: () => void;
  startLoad: () => void;
};

function playbackErrorName(reason: unknown): string {
  return reason && typeof reason === "object" && "name" in reason
    ? String((reason as { name?: unknown }).name || "")
    : "";
}

function playRequestErrorMessage(reason: unknown): string {
  const name = playbackErrorName(reason);
  if (name === "NotSupportedError") return "当前浏览器不支持此视频编码或格式";
  if (name === "NetworkError") return "网络连接中断，请检查网络后重试";
  if (name === "SecurityError") return "浏览器阻止了当前视频地址";
  return "无法开始播放，请重试";
}

function mediaErrorMessage(error: MediaError | null): string {
  if (!error) return "视频加载失败，请重试";
  if (error.code === 1) return "视频加载已中止，请重新播放";
  if (error.code === 2) return "视频加载时网络中断，请检查网络后重试";
  if (error.code === 3) return "视频解码失败，建议更新 Safari 或切换浏览器";
  if (error.code === 4) return "当前浏览器不支持此视频编码或格式";
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
  playSodaPrice = 0,
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
  playSodaPrice?: number;
  initialPlaybackAllowed?: boolean;
  initialAccessExpiresAt?: number | null;
  contentAccessible?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const countedRef = useRef(false);
  const leaseRef = useRef<PlaybackLease | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const hlsRef = useRef<HlsController | null>(null);
  const hlsFallbackTriedRef = useRef(false);
  const hlsNetworkRecoveryRef = useRef(0);
  const hlsMediaRecoveryRef = useRef(0);
  const resumeTimeRef = useRef(0);
  const pendingPlayRef = useRef(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"mp4" | "hls">("mp4");
  const [fallbackSourceUrl, setFallbackSourceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualPlayRequired, setManualPlayRequired] = useState(false);
  const [playbackHint, setPlaybackHint] = useState("");
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
      fallbackMediaUrl?: string;
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
      fallbackMediaUrl: body.fallbackMediaUrl || "",
      format: body.format === "hls" ? "hls" : "mp4",
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
    pendingPlayRef.current = false;
    releaseLease();
    setSourceUrl("");
    setSourceFormat("mp4");
    setFallbackSourceUrl("");
    hlsFallbackTriedRef.current = false;
    setLoading(false);
    setError("");
    setManualPlayRequired(false);
    setPlaybackHint("");
    setError(message);
  }, [releaseLease]);

  const fallbackFromHls = useCallback(() => {
    const fallback = fallbackSourceUrl || leaseRef.current?.fallbackMediaUrl || "";
    if (!fallback || hlsFallbackTriedRef.current) {
      failPlayback("HLS 播放失败，正在等待重试");
      return;
    }
    const video = videoRef.current;
    resumeTimeRef.current = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    hlsFallbackTriedRef.current = true;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setSourceFormat("mp4");
    setSourceUrl(fallback);
    setLoading(true);
    setError("已切换兼容播放模式");
    pendingPlayRef.current = true;
  }, [failPlayback, fallbackSourceUrl]);

  const handlePlayRejection = useCallback((reason: unknown) => {
    const name = playbackErrorName(reason);
    if (name === "NotAllowedError" || name === "AbortError") {
      setLoading(false);
      setError("");
      setManualPlayRequired(true);
      setPlaybackHint(name === "NotAllowedError" ? "视频已就绪，点击播放" : "播放被浏览器暂停，点击继续");
      return;
    }
    failPlayback(playRequestErrorMessage(reason));
  }, [failPlayback]);

  const startPlayback = useCallback(async (force = false) => {
    if (loading && !force) return;
    pendingPlayRef.current = false;
    releaseLease();
    setLoading(true);
    setError("");
    setManualPlayRequired(false);
    setPlaybackHint("");
    hlsFallbackTriedRef.current = false;
    hlsNetworkRecoveryRef.current = 0;
    hlsMediaRecoveryRef.current = 0;
    resumeTimeRef.current = 0;
    try {
      await ensurePlaybackAccess();
      const lease = await acquireLease();
      leaseRef.current = lease;
      pendingPlayRef.current = true;
      setSourceFormat(lease?.format || "mp4");
      setFallbackSourceUrl(lease?.fallbackMediaUrl || "");
      setSourceUrl(lease?.mediaUrl || `${mediaBasePath}/stream?v=${String(Math.floor(sourceVersion))}`);
    } catch (reason) {
      failPlayback(reason instanceof TypeError
        ? "网络连接异常，请检查网络后重试"
        : reason instanceof Error ? reason.message : "暂时无法开始播放");
    }
  }, [acquireLease, ensurePlaybackAccess, failPlayback, loading, mediaBasePath, releaseLease, sourceVersion]);

  const playLoadedVideo = useCallback(() => {
    if (loading) return;
    const lease = leaseRef.current;
    if (lease && lease.expiresAt <= Date.now()) {
      releaseLease();
      setSourceUrl("");
      setManualPlayRequired(false);
      setPlaybackHint("");
      void startPlayback();
      return;
    }
    const video = videoRef.current;
    if (!video) {
      failPlayback("播放器尚未准备好，请重试");
      return;
    }
    setLoading(true);
    setError("");
    setManualPlayRequired(false);
    setPlaybackHint("");
    try {
      void video.play().catch(handlePlayRejection);
    } catch (reason) {
      handlePlayRejection(reason);
    }
  }, [failPlayback, handlePlayRejection, loading, releaseLease, startPlayback]);

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
    const restorePosition = () => {
      const resumeTime = resumeTimeRef.current;
      if (resumeTime > 0 && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(resumeTime, Math.max(video.duration - 0.25, 0));
      }
      resumeTimeRef.current = 0;
    };
    const tryPlay = () => {
      if (!pendingPlayRef.current || cancelled) return;
      pendingPlayRef.current = false;
      void video.play().catch(handlePlayRejection);
    };
    video.pause();
    video.removeAttribute("src");
    if (sourceFormat === "mp4") {
      video.src = sourceUrl;
      video.addEventListener("loadedmetadata", restorePosition, { once: true });
      video.addEventListener("loadedmetadata", tryPlay, { once: true });
      video.load();
      return () => {
        cancelled = true;
        video.removeEventListener("loadedmetadata", restorePosition);
        video.removeEventListener("loadedmetadata", tryPlay);
      };
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = sourceUrl;
      video.addEventListener("loadedmetadata", restorePosition, { once: true });
      video.addEventListener("loadedmetadata", tryPlay, { once: true });
      video.load();
      return () => {
        cancelled = true;
        video.removeEventListener("loadedmetadata", restorePosition);
        video.removeEventListener("loadedmetadata", tryPlay);
      };
    }
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        fallbackFromHls();
        return;
      }
      const hls = new Hls({
        capLevelToPlayerSize: true,
        enableWorker: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        lowLatencyMode: false,
      });
      hlsRef.current = hls;
      video.addEventListener("loadedmetadata", restorePosition, { once: true });
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(sourceUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
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
        fallbackFromHls();
      });
      hls.attachMedia(video);
    }).catch(() => fallbackFromHls());
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", restorePosition);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [fallbackFromHls, handlePlayRejection, sourceFormat, sourceUrl]);

  useEffect(() => releaseLease, [releaseLease]);

  function recordPlay() {
    const currentLease = leaseRef.current;
    if (currentLease && currentLease.expiresAt <= Date.now()) {
      videoRef.current?.pause();
      releaseLease();
      setSourceUrl("");
      void startPlayback(true);
      return;
    }
    setLoading(false);
    setError("");
    setManualPlayRequired(false);
    setPlaybackHint("");
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
          setError("播放会话已失效，请重新播放");
          setSourceUrl("");
          return;
        }
        activeLease.expiresAt = body.expiresAt;
      } catch {
        // A later heartbeat retries; media delivery itself remains uninterrupted.
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
  const needsLogin = !contentAccessible;
  const needsUnlock = contentAccessible && !playbackAllowed && playSodaPrice > 0;

  return (
    <div className="mediaVideoPlayerShell">
      <video
        ref={videoRef}
        className="mediaVideoPlayer"
        controls={Boolean(sourceUrl)}
        playsInline
        poster={poster}
        preload={sourceUrl ? "metadata" : "none"}
        src={sourceUrl || undefined}
        onPlay={recordPlay}
        onPlaying={() => {
          setLoading(false);
          setError("");
        }}
        onCanPlay={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onStalled={() => setLoading(true)}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={(event) => {
          if (sourceUrl) {
            if (sourceFormat === "hls") fallbackFromHls();
            else failPlayback(mediaErrorMessage(event.currentTarget.error));
          }
        }}
      >
        当前浏览器无法播放这个视频。
      </video>
      {!sourceUrl || loading || error || manualPlayRequired ? (
        <div className="mediaVideoStartLayer">
          <button
            className={needsUnlock || needsLogin ? "isUnlockAction" : ""}
            type="button"
            onClick={() => {
              if (needsLogin) {
                window.location.assign(`/login?${new URLSearchParams({ returnTo: `/media/${id}` }).toString()}`);
                return;
              }
              if (manualPlayRequired && sourceUrl) {
                playLoadedVideo();
                return;
              }
              void startPlayback();
            }}
            disabled={loading}
            aria-label={needsLogin ? "登录后播放" : needsUnlock ? `使用 ${playSodaPrice} 苏打解锁 24 小时` : manualPlayRequired ? "视频已就绪，点击播放" : error ? "重新播放" : "播放视频"}
          >
            {loading ? <LoaderCircle className="isSpinning" size={23} aria-hidden="true" /> :
              needsLogin ? (
                <><LogIn size={20} aria-hidden="true" /><span>登录后播放</span></>
              ) : needsUnlock ? (
                <><CupSoda size={20} aria-hidden="true" /><span>{playSodaPrice} 苏打 · 24 小时</span></>
              ) : error ? <RotateCcw size={22} aria-hidden="true" /> : <Play size={24} fill="currentColor" aria-hidden="true" />}
          </button>
          {error ? <p role="alert">{error}</p> : null}
          {!error && playbackHint ? <p>{playbackHint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
