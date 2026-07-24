"use client";

import { ChevronRight, Folder } from "lucide-react";
import Link from "next/link";

export function MediaFolderRow({ href, name, sizeLabel }: { href: string; name: string; sizeLabel?: string }) {
  return (
    <Link
      className="mediaResourceRow mediaFolderListRow"
      href={href}
      draggable={false}
      title={`打开 ${name}`}
      aria-label={`打开文件夹 ${name}`}
    >
      <span className="mediaAssetIcon is-folder" aria-hidden="true"><Folder size={21} /></span>
      <span className="mediaCardCopy">
        <strong title={name}>{name}</strong>
        <small>文件夹</small>
      </span>
      <span className="mediaCardSize">{sizeLabel}</span>
      <ChevronRight size={17} aria-hidden="true" />
    </Link>
  );
}
