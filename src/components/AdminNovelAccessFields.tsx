"use client";

import { useState } from "react";
import type { NovelAccessMode, NovelStorageMode } from "@/lib/novel-library";
import { AdminSelect } from "./AdminSelect";

export function AdminNovelAccessFields({
  accessMode,
  sodaPrice,
  previewChapterCount,
  storageMode,
  chapterCount,
}: {
  accessMode: NovelAccessMode;
  sodaPrice: number;
  previewChapterCount: number;
  storageMode: NovelStorageMode;
  chapterCount: number;
}) {
  const [mode, setMode] = useState<NovelAccessMode>(accessMode);
  return (
    <div className="adminNovelAccessFields">
      <label>
        <span>阅读权限</span>
        <AdminSelect name="accessMode" value={mode} onChange={(event) => setMode(event.target.value as NovelAccessMode)}>
          <option value="inherit">跟随小说访问设置</option>
          <option value="soda">苏打解锁</option>
        </AdminSelect>
      </label>
      {mode === "soda" ? (
        <>
          <label>
            <span>解锁价格</span>
            <input name="sodaPrice" type="number" min="1" max="1000000" defaultValue={Math.max(sodaPrice, 1)} required />
          </label>
          {storageMode === "chapters" ? (
            <label>
              <span>试读章节</span>
              <input
                name="previewChapterCount"
                type="number"
                min="0"
                max={chapterCount}
                defaultValue={previewChapterCount}
              />
              <small>系统至少开放前约 30%；填写更大数值可增加试读章节</small>
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
