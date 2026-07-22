"use client";

import { ChevronRight, Folder } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { beginNavigationProgress } from "./NavigationProgress";

export function MediaFolderRow({ href, name, sizeLabel }: { href: string; name: string; sizeLabel?: string }) {
  const router = useRouter();
  const pointerType = useRef("");

  return (
    <Link
      className="mediaResourceRow mediaFolderListRow"
      href={href}
      draggable={false}
      title="双击打开文件夹"
      aria-label={`打开文件夹 ${name}`}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
      }}
      onClick={(event) => {
        if (event.detail > 0 && pointerType.current === "mouse") event.preventDefault();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        beginNavigationProgress();
        router.push(href);
      }}
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
