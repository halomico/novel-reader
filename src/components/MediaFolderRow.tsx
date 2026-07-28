"use client";

import { ChevronRight, Folder } from "lucide-react";
import Link from "@/components/LocalizedLink";
import { uiText, type AppLocale } from "@/lib/locale";

export function MediaFolderRow({
  href,
  name,
  sizeLabel,
  locale,
}: {
  href: string;
  name: string;
  sizeLabel?: string;
  locale: AppLocale;
}) {
  return (
    <Link
      className="mediaResourceRow mediaFolderListRow"
      href={href}
      draggable={false}
      title={`${locale === "zh-Hant" ? "開啟" : "打开"} ${name}`}
      aria-label={`${locale === "zh-Hant" ? "開啟資料夾" : "打开文件夹"} ${name}`}
    >
      <span className="mediaAssetIcon is-folder" aria-hidden="true"><Folder size={21} /></span>
      <span className="mediaCardCopy">
        <strong title={name}>{name}</strong>
        <small>{uiText(locale, "文件夹")}</small>
      </span>
      <span className="mediaCardSize">{sizeLabel}</span>
      <ChevronRight size={17} aria-hidden="true" />
    </Link>
  );
}
