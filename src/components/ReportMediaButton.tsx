"use client";

import type { FeedbackMediaKind } from "@/lib/media";
import { ContentReportButton, type ContentReportOption } from "./ContentReportButton";

const REPORT_OPTIONS: Record<FeedbackMediaKind, ContentReportOption[]> = {
  video: [
    { value: "title_error", label: "标题或简介有误" },
    { value: "playback_error", label: "无法播放或播放异常" },
    { value: "spam", label: "画面或内容问题" },
    { value: "other", label: "其他问题" },
  ],
  audio: [
    { value: "title_error", label: "标题或作者有误" },
    { value: "playback_error", label: "无法播放或播放异常" },
    { value: "spam", label: "音质或内容问题" },
    { value: "other", label: "其他问题" },
  ],
};

export function ReportMediaButton({ mediaId, title, kind }: { mediaId: number; title: string; kind: FeedbackMediaKind }) {
  return <ContentReportButton target={{ mediaId }} title={title} dialogTitle={`反馈${kind === "audio" ? "音频" : "视频"}问题`} options={REPORT_OPTIONS[kind]} defaultCategory="playback_error" />;
}
