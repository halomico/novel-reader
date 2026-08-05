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
  activeTrackIdRef.current = activeTrack.id;
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
    audio.pause();
    loadedTrackIdRef.current = activeTrack.id;
    pendingAutoPlayTrackIdRef.current = shouldAutoPlay ? activeTrack.id : null;
    setAudioStatus("loading");
    setAudioStatusMessage(uiText(locale, "正在加载音频…"));
    audio.load();
  }, [activeTrack.id, locale]);

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
    setAudioStatus("ready");
    setAudioStatusMessage("");
    if (pendingAutoPlayTrackIdRef.current !== activeTrack.id) return;
    pendingAutoPlayTrackIdRef.current = null;
    playWhenReady(audio, activeTrack.id);
  }

  function handleAudioError() {
    pendingAutoPlayTrackIdRef.current = null;
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
          preload="metadata"
          src={`${basePathPrefix}/${activeTrack.id}/stream?v=${Math.floor(activeTrack.version)}`}
          onLoadStart={() => {
            setAudioStatus("loading");
            setAudioStatusMessage(uiText(locale, "正在加载音频…"));
          }}
          onCanPlay={handleCanPlay}
          onPlaying={() => {
            setAudioStatus("ready");
            setAudioStatusMessage("");
          }}
          onWaiting={() => {
            setAudioStatus("loading");
            setAudioStatusMessage(uiText(locale, "网络较慢，音频仍在加载…"));
          }}
          onStalled={() => {
            setAudioStatus("notice");
            setAudioStatusMessage(uiText(locale, "音频加载较慢，正在继续尝试…"));
          }}
          onError={handleAudioError}
          onPlay={recordPlay}
          onPause={() => {
            autoPlayRef.current = false;
            pendingAutoPlayTrackIdRef.current = null;
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
