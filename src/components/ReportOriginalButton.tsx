"use client";

import { ContentReportButton, type ContentReportOption } from "./ContentReportButton";

const REPORT_OPTIONS: ContentReportOption[] = [
  { value: "title_error", label: "标题有误" },
  { value: "tag_error", label: "标签有误" },
  { value: "spam", label: "垃圾或不当内容" },
  { value: "other", label: "其他问题" },
];

export function ReportOriginalButton({ articleId, title, variant = "icon" }: { articleId: number; title: string; variant?: "icon" | "text" | "responsive" }) {
  return <ContentReportButton target={{ originalArticleId: articleId }} title={title} dialogTitle="反馈原创文章" options={REPORT_OPTIONS} defaultCategory="spam" variant={variant} />;
}
