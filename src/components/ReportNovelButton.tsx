"use client";

import { ContentReportButton, type ContentReportOption } from "./ContentReportButton";

const REPORT_OPTIONS: ContentReportOption[] = [
  { value: "title_error", label: "标题有误" },
  { value: "tag_error", label: "标签有误" },
  { value: "hotword_error", label: "热词有误" },
  { value: "spam", label: "垃圾页面" },
  { value: "other", label: "其他" },
];

export function ReportNovelButton({ novelId, title, variant = "icon" }: { novelId: number; title: string; variant?: "icon" | "text" | "responsive" }) {
  return <ContentReportButton target={{ novelId }} title={title} dialogTitle="反馈内容问题" options={REPORT_OPTIONS} defaultCategory="tag_error" variant={variant} />;
}
