"use client";

import { CupSoda, LoaderCircle, LogIn, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlaybackLease = {
  sessionId: string;
  token: string;
  expiresAt: number;
};

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
  const pendingPlayRef = useRef(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
    const body = await response.json() as {
      ok?: boolean;
      message?: string;
      sessionId?: string;
      token?: string;
      expiresAt?: number;
    };
    if (!response.ok || !body.sessionId || !body.token || !body.expiresAt) {
      throw new Error(body.message || "暂时无法开始播放");
    }
    return { sessionId: body.sessionId, token: body.token, expiresAt: body.expiresAt };
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
    const body = await response.json() as {
      ok?: boolean;
      message?: string;
      expiresAt?: number | null;
    };
    if (!response.ok || !body.ok) throw new Error(body.message || "暂时无法解锁视频");
    setPlaybackAllowed(true);
    setAccessExpiresAt(body.expiresAt || null);
  }, [accessExpiresAt, authenticated, contentAccessible, id, playbackAllowed]);

  const startPlayback = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await ensurePlaybackAccess();
      const lease = await acquireLease();
      leaseRef.current = lease;
      const params = new URLSearchParams({ v: String(Math.floor(sourceVersion)) });
      if (lease) {
        params.set("ps", lease.sessionId);
        params.set("pt", lease.token);
      }
      pendingPlayRef.current = true;
      setSourceUrl(`${mediaBasePath}/stream?${params.toString()}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法开始播放");
      setLoading(false);
    }
  }, [acquireLease, ensurePlaybackAccess, loading, mediaBasePath, sourceVersion]);

  useEffect(() => {
    if (!sourceUrl || !pendingPlayRef.current) return;
    pendingPlayRef.current = false;
    const video = videoRef.current;
    if (!video) return;
    video.load();
    void video.play().catch(() => {
      setLoading(false);
    });
  }, [sourceUrl]);

  useEffect(() => releaseLease, [releaseLease]);

  function recordPlay() {
    const currentLease = leaseRef.current;
    if (currentLease && currentLease.expiresAt <= Date.now()) {
      videoRef.current?.pause();
      releaseLease();
      setSourceUrl("");
      void startPlayback();
      return;
    }
    setLoading(false);
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
        onPlay={recordPlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={() => {
          if (sourceUrl) {
            setLoading(false);
            setError("视频加载失败，请重试");
          }
        }}
      >
        {sourceUrl ? <source src={sourceUrl} /> : null}
        当前浏览器无法播放这个视频。
      </video>
      {!sourceUrl || error ? (
        <div className="mediaVideoStartLayer">
          <button
            className={needsUnlock || needsLogin ? "isUnlockAction" : ""}
            type="button"
            onClick={() => {
              if (needsLogin) {
                window.location.assign(`/login?${new URLSearchParams({ returnTo: `/media/${id}` }).toString()}`);
                return;
              }
              void startPlayback();
            }}
            disabled={loading}
            aria-label={needsLogin ? "登录后播放" : needsUnlock ? `使用 ${playSodaPrice} 苏打解锁 3 小时` : error ? "重新播放" : "播放视频"}
          >
            {loading ? <LoaderCircle className="isSpinning" size={23} aria-hidden="true" /> :
              needsLogin ? (
                <><LogIn size={20} aria-hidden="true" /><span>登录后播放</span></>
              ) : needsUnlock ? (
                <><CupSoda size={20} aria-hidden="true" /><span>{playSodaPrice} 苏打 · 3 小时</span></>
              ) : error ? <RotateCcw size={22} aria-hidden="true" /> : <Play size={24} fill="currentColor" aria-hidden="true" />}
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
