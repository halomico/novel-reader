"use client";

import { Save, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { saveNovelChaptersAction } from "@/app/admin/actions";
import type { NovelChapter } from "@/lib/novel-library";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AdminChapterManager({
  novelId,
  page,
  chapters,
}: {
  novelId: number;
  page: number;
  chapters: NovelChapter[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const allSelected = chapters.length > 0 && chapters.every((chapter) => selected.has(chapter.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(chapters.map((chapter) => chapter.id)));
  }

  function confirmIntent(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== "delete") return;
    if (!selected.size) {
      event.preventDefault();
      return;
    }
    if (!window.confirm(`删除选中的 ${selected.size} 个章节？正文文件也会一并删除。`)) event.preventDefault();
  }

  return (
    <form className="adminChapterManager" action={saveNovelChaptersAction} onSubmit={confirmIntent}>
      <input name="bookId" type="hidden" value={novelId} />
      <input name="page" type="hidden" value={page} />
      <div className="adminChapterTableWrap">
        <table className="adminChapterTable">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="选择当前页全部章节" />
              </th>
              <th>顺序</th>
              <th>章节标题</th>
              <th>文件</th>
              <th>大小</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((chapter) => (
              <tr key={chapter.id}>
                <td>
                  <input
                    name="selectedChapterIds"
                    type="checkbox"
                    value={chapter.id}
                    checked={selected.has(chapter.id)}
                    onChange={(event) => setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(chapter.id);
                      else next.delete(chapter.id);
                      return next;
                    })}
                    aria-label={`选择 ${chapter.title}`}
                  />
                  <input name="chapterRowIds" type="hidden" value={chapter.id} />
                </td>
                <td>
                  <input className="adminChapterOrderInput" name={`chapterSort:${chapter.id}`} type="number" min="1" defaultValue={chapter.sortOrder + 1} aria-label={`${chapter.title} 的顺序`} />
                </td>
                <td>
                  <input className="adminChapterTitleInput" name={`chapterTitle:${chapter.id}`} defaultValue={chapter.title} maxLength={160} required />
                </td>
                <td><span className="adminChapterFileName" title={chapter.relativePath}>{chapter.relativePath.split("/").at(-1)}</span></td>
                <td><small>{formatBytes(chapter.sizeBytes)}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        <button className="adminDangerButton" name="intent" value="delete" type="submit" disabled={!selected.size}>
          <Trash2 size={15} aria-hidden="true" />删除
        </button>
        <button className="adminPrimaryButton" name="intent" value="save" type="submit">
          <Save size={15} aria-hidden="true" />保存
        </button>
      </footer>
    </form>
  );
}
