"use client";

import { Disc3, ListMusic, Play, Repeat1, SkipBack, SkipForward, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AudioPlaybackMode } from "@/lib/site-settings";

export type AudioQueueTrack = {
  id: number;
  title: string;
  artist: string;
  version: number;
};

const MODE_LABELS: Record<AudioPlaybackMode, string> = {
  stop: "播完暂停",
  next: "自动连播",
  "repeat-one": "单曲循环",
};

const QUEUE_ROW_HEIGHT = 36;
const QUEUE_VIEWPORT_HEIGHT = 260;
const QUEUE_OVERSCAN = 5;

export function MediaAudioPlayer({
  initialId,
  tracks,
  basePathPrefix = "/media",
  defaultPlaybackMode = "next",
}: {
  initialId: number;
  tracks: AudioQueueTrack[];
  basePathPrefix?: string;
  defaultPlaybackMode?: AudioPlaybackMode;
}) {
  const initialTrack = tracks.find((track) => track.id === initialId) || tracks[0];
  const [activeTrack, setActiveTrack] = useState(initialTrack);
  const [mode, setMode] = useState<AudioPlaybackMode>(defaultPlaybackMode);
  const audioRef = useRef<HTMLAudioElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const autoPlayRef = useRef(false);
  const countedIdsRef = useRef(new Set<number>());
  const [queueScrollTop, setQueueScrollTop] = useState(0);
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
    if (!audio) return;
    audio.load();
    if (autoPlayRef.current) {
      autoPlayRef.current = false;
      void audio.play().catch(() => undefined);
    }
  }, [activeTrack.id]);

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

  function chooseTrack(track: AudioQueueTrack, autoPlay = true) {
    if (track.id === activeTrack.id) return;
    autoPlayRef.current = autoPlay;
    setActiveTrack(track);
    void fetch(`${basePathPrefix}/${track.id}/access`, { method: "POST", keepalive: true });
  }

  function recordPlay() {
    if (countedIdsRef.current.has(activeTrack.id)) return;
    countedIdsRef.current.add(activeTrack.id);
    void fetch(`${basePathPrefix}/${activeTrack.id}/play`, { method: "POST", keepalive: true }).catch(() => countedIdsRef.current.delete(activeTrack.id));
  }

  function playAdjacent(offset: -1 | 1) {
    const track = tracks[activeIndex + offset];
    if (track) chooseTrack(track);
  }

  function handleEnded() {
    const audio = audioRef.current;
    if (mode === "repeat-one" && audio) {
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    if (mode === "next") playAdjacent(1);
  }

  return (
    <section className="mediaAudioStage">
      <div className="mediaAudioNowPlaying">
        <span className="mediaAudioDetailCover" aria-hidden="true"><Disc3 size={48} /></span>
        <div>
          <strong title={activeTrack.title}>{activeTrack.title}</strong>
          <small>{activeTrack.artist || "未知作者"}</small>
        </div>
      </div>
      <div className="mediaAudioPlayerPanel">
        <audio ref={audioRef} className="mediaAudioPlayer" controls autoPlay preload="metadata" onPlay={recordPlay} onEnded={handleEnded} aria-label={`播放 ${activeTrack.title}`}>
          <source src={`${basePathPrefix}/${activeTrack.id}/stream?v=${Math.floor(activeTrack.version)}`} />
          当前浏览器无法播放这个音频。
        </audio>
        <div className="mediaAudioControls">
          <div className="mediaAudioTransport" aria-label="切换音频">
            <button type="button" onClick={() => playAdjacent(-1)} disabled={activeIndex <= 0} aria-label="上一首" title="上一首">
              <SkipBack size={17} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => playAdjacent(1)} disabled={activeIndex < 0 || activeIndex >= tracks.length - 1} aria-label="下一首" title="下一首">
              <SkipForward size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="mediaPlaybackModes" aria-label="播放模式">
            <button className={mode === "stop" ? "isActive" : ""} type="button" onClick={() => chooseMode("stop")} aria-label={MODE_LABELS.stop} title={MODE_LABELS.stop} aria-pressed={mode === "stop"}>
              <Square size={15} aria-hidden="true" />
            </button>
            <button className={mode === "next" ? "isActive" : ""} type="button" onClick={() => chooseMode("next")} aria-label={MODE_LABELS.next} title={MODE_LABELS.next} aria-pressed={mode === "next"}>
              <ListMusic size={16} aria-hidden="true" />
            </button>
            <button className={mode === "repeat-one" ? "isActive" : ""} type="button" onClick={() => chooseMode("repeat-one")} aria-label={MODE_LABELS["repeat-one"]} title={MODE_LABELS["repeat-one"]} aria-pressed={mode === "repeat-one"}>
              <Repeat1 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mediaAudioQueue">
          <header>
            <strong>同目录音频</strong>
            <span>{tracks.length} 首</span>
          </header>
          <div className="mediaAudioQueueViewport" ref={queueRef} onScroll={(event) => setQueueScrollTop(event.currentTarget.scrollTop)}>
            {visibleStart ? <div className="mediaAudioQueueSpacer" style={{ height: visibleStart * QUEUE_ROW_HEIGHT }} aria-hidden="true" /> : null}
            {visibleTracks.map((track) => (
              <button className={track.id === activeTrack.id ? "isActive" : ""} type="button" onClick={() => chooseTrack(track)} key={track.id}>
                <span aria-hidden="true">{track.id === activeTrack.id ? <Play size={13} fill="currentColor" /> : null}</span>
                <strong title={track.title}>{track.title}</strong>
                <small title={track.artist}>{track.artist || "未知作者"}</small>
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
