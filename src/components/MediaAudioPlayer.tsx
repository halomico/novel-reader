"use client";

import { CircleAlert, Disc3, ListMusic, LoaderCircle, Play, Repeat1, SkipBack, SkipForward, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaAudioFeedbackActions } from "@/components/MediaAudioFeedbackActions";
import { formatMediaDuration } from "@/lib/media-format";
import type { AudioPlaybackMode } from "@/lib/site-settings";
import { DEFAULT_LOCALE, uiText, type AppLocale } from "@/lib/locale";

export type AudioQueueTrack = {
  id: number;
  title: string;
  artist: string;
  durationSeconds: number | null;
  version: number;
};

export type AudioFeedbackOptions = {
  initialFavorite: boolean;
  initialRecommended: boolean;
  initialInGrove: boolean;
  canRecommend: boolean;
  canReport: boolean;
};

const MODE_LABELS: Record<AudioPlaybackMode, string> = {
  stop: "播完暂停",
  next: "自动连播",
  "repeat-one": "单曲循环",
};

const QUEUE_ROW_HEIGHT = 52;
const QUEUE_VIEWPORT_HEIGHT = 312;
const QUEUE_OVERSCAN = 5;

type AudioStatus = "ready" | "loading" | "notice" | "error";

function audioErrorMessage(error: MediaError | null, locale: AppLocale): string {
  if (!error) return uiText(locale, "音频加载失败，请稍后重试。");
  if (error.code === MediaError.MEDIA_ERR_NETWORK) return uiText(locale, "音频网络加载失败，请检查连接后重试。");
  if (error.code === MediaError.MEDIA_ERR_DECODE) return uiText(locale, "当前音频无法解码，请切换浏览器或联系管理员。");
  if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return uiText(locale, "音频地址不可用或浏览器不支持此格式。");
  return uiText(locale, "音频加载已中断，请重新播放。");
}

export function MediaAudioPlayer({
  initialId,
  tracks,
  basePathPrefix = "/media",
  defaultPlaybackMode = "next",
  feedback,
  locale = DEFAULT_LOCALE,
}: {
  initialId: number;
  tracks: AudioQueueTrack[];
  basePathPrefix?: string;
  defaultPlaybackMode?: AudioPlaybackMode;
  feedback?: AudioFeedbackOptions;
  locale?: AppLocale;
}) {
  const initialTrack = tracks.find((track) => track.id === initialId) || tracks[0];
  const [activeTrack, setActiveTrack] = useState(initialTrack);
  const [mode, setMode] = useState<AudioPlaybackMode>(defaultPlaybackMode);
  const audioRef = useRef<HTMLAudioElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const autoPlayRef = useRef(false);
  const pendingAutoPlayTrackIdRef = useRef<number | null>(null);
  const activeTrackIdRef = useRef(initialTrack.id);
  const loadedTrackIdRef = useRef(initialTrack.id);
  const countedIdsRef = useRef(new Set<number>());
  const [queueScrollTop, setQueueScrollTop] = useState(0);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("ready");
  const [audioStatusMessage, setAudioStatusMessage] = useState("");
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryAttemptRef = useRef(false);
  const pendingSeekTimeRef = useRef<number | null>(null);
  activeTrackIdRef.current = activeTrack.id;

  function clearWaitingTimer() {
    if (waitingTimerRef.current) {
      clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
  }

  function clearRecoveryTimer() {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }

  function markReady() {
    clearWaitingTimer();
    clearRecoveryTimer();
    setAudioStatus("ready");
    setAudioStatusMessage("");
  }

  function restorePendingSeek(audio: HTMLAudioElement) {
    const target = pendingSeekTimeRef.current;
    if (target == null) return;
    if (!Number.isFinite(target)) {
      pendingSeekTimeRef.current = null;
      return;
    }
    try {
      audio.currentTime = target;
      pendingSeekTimeRef.current = null;
    } catch {
      // Metadata may be present before the browser accepts a seek. Keep the
      // target for the next canplay event instead of losing the user's place.
    }
  }

  /** Only show “loading…” if buffering lasts a moment — avoid flicker when nearly ready. */
  function markBuffering(message: string) {
    clearWaitingTimer();
    waitingTimerRef.current = setTimeout(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) return;
      // HAVE_FUTURE_DATA / HAVE_ENOUGH_DATA → already playable
      if (audio.readyState >= 3) return;
      setAudioStatus("loading");
      setAudioStatusMessage(message);
    }, 450);
    // A remote node can leave a media element in HAVE_METADATA after an
    // interrupted range request. Give the browser one bounded retry instead
    // of repeatedly calling load() on every `stalled` event.
    clearRecoveryTimer();
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended || audio.readyState >= 3 || recoveryAttemptRef.current) return;
      recoveryAttemptRef.current = true;
      pendingSeekTimeRef.current = Number.isFinite(audio.currentTime) ? audio.currentTime : null;
      pendingAutoPlayTrackIdRef.current = activeTrackIdRef.current;
      audio.load();
    }, 12_000);
  }
  const activeIndex = tracks.findIndex((track) => track.id === activeTrack.id);
  const visibleStart = Math.max(0, Math.floor(queueScrollTop / QUEUE_ROW_HEIGHT) - QUEUE_OVERSCAN);
  const visibleEnd = Math.min(tracks.length, Math.ceil((queueScrollTop + QUEUE_VIEWPORT_HEIGHT) / QUEUE_ROW_HEIGHT) + QUEUE_OVERSCAN);
  const visibleTracks = tracks.slice(visibleStart, visibleEnd);

  useEffect(() => {
    const stored = window.localStorage.getItem("media-audio-playback-mode");
    if (stored === "stop" || stored === "next" || stored === "repeat-one") setMode(stored);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || loadedTrackIdRef.current === activeTrack.id) return;
    const shouldAutoPlay = autoPlayRef.current;
    autoPlayRef.current = false;
    recoveryAttemptRef.current = false;
    pendingSeekTimeRef.current = null;
    clearRecoveryTimer();
    audio.pause();
    loadedTrackIdRef.current = activeTrack.id;
    pendingAutoPlayTrackIdRef.current = shouldAutoPlay ? activeTrack.id : null;
    // Switching tracks: soft loading only if metadata not already available.
    if (audio.readyState < 1) {
      setAudioStatus("loading");
      setAudioStatusMessage(uiText(locale, "正在加载音频…"));
    } else {
      markReady();
    }
    audio.load();
  }, [activeTrack.id, locale]);

  useEffect(() => () => {
    clearWaitingTimer();
    clearRecoveryTimer();
  }, []);

  useEffect(() => {
    const queue = queueRef.current;
    if (!queue || activeIndex < 0) return;
    const itemTop = activeIndex * QUEUE_ROW_HEIGHT;
    const itemBottom = itemTop + QUEUE_ROW_HEIGHT;
    if (itemTop < queue.scrollTop || itemBottom > queue.scrollTop + QUEUE_VIEWPORT_HEIGHT) {
      const nextTop = Math.max(0, itemTop - (QUEUE_VIEWPORT_HEIGHT - QUEUE_ROW_HEIGHT) / 2);
      queue.scrollTop = nextTop;
      setQueueScrollTop(nextTop);
    }
  }, [activeIndex]);

  function chooseMode(nextMode: AudioPlaybackMode) {
    setMode(nextMode);
    window.localStorage.setItem("media-audio-playback-mode", nextMode);
  }

  function chooseTrack(track: AudioQueueTrack, autoPlay = false) {
    if (track.id === activeTrack.id) return;
    autoPlayRef.current = autoPlay;
    pendingAutoPlayTrackIdRef.current = null;
    setActiveTrack(track);
    void fetch(`${basePathPrefix}/${track.id}/access`, { method: "POST", keepalive: true });
  }

  function playWhenReady(audio: HTMLAudioElement, trackId: number) {
    void audio.play().catch((error: unknown) => {
      if (activeTrackIdRef.current !== trackId) return;
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      setAudioStatus(blocked ? "notice" : "error");
      setAudioStatusMessage(blocked
        ? uiText(locale, "音频已切换，请点击播放继续。")
        : uiText(locale, "播放启动失败，请重新点击播放。"));
    });
  }

  function handleCanPlay() {
    const audio = audioRef.current;
    if (!audio) return;
    restorePendingSeek(audio);
    markReady();
    if (pendingAutoPlayTrackIdRef.current !== activeTrack.id) return;
    pendingAutoPlayTrackIdRef.current = null;
    playWhenReady(audio, activeTrack.id);
  }

  function handleAudioError() {
    pendingAutoPlayTrackIdRef.current = null;
    clearWaitingTimer();
    setAudioStatus("error");
    setAudioStatusMessage(audioErrorMessage(audioRef.current?.error || null, locale));
  }

  function recordPlay() {
    if (countedIdsRef.current.has(activeTrack.id)) return;
    countedIdsRef.current.add(activeTrack.id);
    void fetch(`${basePathPrefix}/${activeTrack.id}/play`, { method: "POST", keepalive: true }).catch(() => countedIdsRef.current.delete(activeTrack.id));
  }

  function playAdjacent(offset: -1 | 1, autoPlay = false) {
    const track = tracks[activeIndex + offset];
    if (track) chooseTrack(track, autoPlay);
  }

  function handleEnded() {
    const audio = audioRef.current;
    if (mode === "repeat-one" && audio) {
      audio.currentTime = 0;
      playWhenReady(audio, activeTrack.id);
      return;
    }
    if (mode === "next") playAdjacent(1, true);
  }

  return (
    <section className="mediaAudioStage">
      <div className="mediaAudioNowPlaying">
        <span className="mediaAudioDetailCover" aria-hidden="true"><Disc3 size={48} /></span>
        <div>
          <strong title={activeTrack.title}>{activeTrack.title}</strong>
          <small>{activeTrack.artist || uiText(locale, "未知作者")}</small>
        </div>
      </div>
      <div className="mediaAudioPlayerPanel">
        <audio
          ref={audioRef}
          className="mediaAudioPlayer"
          controls
          crossOrigin="anonymous"
          preload="metadata"
          src={`${basePathPrefix}/${activeTrack.id}/stream?v=${Math.floor(activeTrack.version)}`}
          onLoadStart={() => {
            const audio = audioRef.current;
            // Initial load only — avoid sticky “loading” after canplay has already fired.
            if (audio && audio.readyState >= 2) return;
            setAudioStatus("loading");
            setAudioStatusMessage(uiText(locale, "正在加载音频…"));
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) restorePendingSeek(audioRef.current);
            markReady();
          }}
          onLoadedData={markReady}
          onCanPlay={handleCanPlay}
          onCanPlayThrough={markReady}
          onPlaying={markReady}
          onProgress={() => {
            const audio = audioRef.current;
            if (audio && audio.readyState >= 3) markReady();
          }}
          onSeeking={() => {
            clearWaitingTimer();
            markBuffering(uiText(locale, "正在定位音频…"));
          }}
          onSeeked={() => {
            const audio = audioRef.current;
            if (audio && audio.readyState >= 2) markReady();
            else markBuffering(uiText(locale, "音频加载较慢，正在继续尝试…"));
          }}
          onWaiting={() => {
            markBuffering(uiText(locale, "网络较慢，音频仍在加载…"));
          }}
          onStalled={() => {
            markBuffering(uiText(locale, "音频加载较慢，正在继续尝试…"));
          }}
          onError={handleAudioError}
          onPlay={recordPlay}
          onPause={() => {
            autoPlayRef.current = false;
            pendingAutoPlayTrackIdRef.current = null;
            clearWaitingTimer();
            clearRecoveryTimer();
          }}
          onEnded={handleEnded}
          aria-label={`${uiText(locale, "播放")} ${activeTrack.title}`}
        >
          {uiText(locale, "当前浏览器无法播放这个音频。")}
        </audio>
        {audioStatus !== "ready" && audioStatusMessage ? (
          <p className={`mediaAudioStatus is-${audioStatus}`} role={audioStatus === "error" ? "alert" : "status"}>
            {audioStatus === "loading" ? <LoaderCircle className="isSpinning" size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
            <span>{audioStatusMessage}</span>
          </p>
        ) : null}
        <div className="mediaAudioControls">
          <div className="mediaAudioPlaybackControls">
            <div className="mediaAudioTransport" aria-label={uiText(locale, "切换音频")}>
              <button type="button" onClick={() => playAdjacent(-1, true)} disabled={activeIndex <= 0} aria-label={uiText(locale, "上一首")} title={uiText(locale, "上一首")}>
                <SkipBack size={17} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => playAdjacent(1, true)} disabled={activeIndex < 0 || activeIndex >= tracks.length - 1} aria-label={uiText(locale, "下一首")} title={uiText(locale, "下一首")}>
                <SkipForward size={17} aria-hidden="true" />
              </button>
            </div>
            {feedback ? (
              <MediaAudioFeedbackActions
                mediaId={activeTrack.id}
                initialMediaId={initialId}
                initialFavorite={feedback.initialFavorite}
                initialRecommended={feedback.initialRecommended}
                initialInGrove={feedback.initialInGrove}
                canRecommend={feedback.canRecommend}
                canReport={feedback.canReport}
                title={activeTrack.title}
              />
            ) : null}
          </div>
          <div className="mediaPlaybackModes" aria-label={uiText(locale, "播放模式")}>
            <button className={mode === "stop" ? "isActive" : ""} type="button" onClick={() => chooseMode("stop")} aria-label={uiText(locale, MODE_LABELS.stop)} title={uiText(locale, MODE_LABELS.stop)} aria-pressed={mode === "stop"}>
              <Square size={15} aria-hidden="true" />
            </button>
            <button className={mode === "next" ? "isActive" : ""} type="button" onClick={() => chooseMode("next")} aria-label={uiText(locale, MODE_LABELS.next)} title={uiText(locale, MODE_LABELS.next)} aria-pressed={mode === "next"}>
              <ListMusic size={16} aria-hidden="true" />
            </button>
            <button className={mode === "repeat-one" ? "isActive" : ""} type="button" onClick={() => chooseMode("repeat-one")} aria-label={uiText(locale, MODE_LABELS["repeat-one"])} title={uiText(locale, MODE_LABELS["repeat-one"])} aria-pressed={mode === "repeat-one"}>
              <Repeat1 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mediaAudioQueue">
          <header>
            <strong>{uiText(locale, "同目录音频")}</strong>
            <span>{tracks.length} {uiText(locale, "首")}</span>
          </header>
          <div className="mediaAudioQueueViewport" ref={queueRef} onScroll={(event) => setQueueScrollTop(event.currentTarget.scrollTop)}>
            {visibleStart ? <div className="mediaAudioQueueSpacer" style={{ height: visibleStart * QUEUE_ROW_HEIGHT }} aria-hidden="true" /> : null}
            {visibleTracks.map((track) => (
              <button className={track.id === activeTrack.id ? "isActive" : ""} type="button" onClick={() => chooseTrack(track, true)} key={track.id}>
                <span aria-hidden="true">{track.id === activeTrack.id ? <Play size={13} fill="currentColor" /> : null}</span>
                <strong title={track.title}>{track.title}</strong>
                <time aria-label={`${uiText(locale, "时长")} ${formatMediaDuration(track.durationSeconds)}`}>
                  {formatMediaDuration(track.durationSeconds)}
                </time>
              </button>
            ))}
            {visibleEnd < tracks.length ? (
              <div className="mediaAudioQueueSpacer" style={{ height: (tracks.length - visibleEnd) * QUEUE_ROW_HEIGHT }} aria-hidden="true" />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
