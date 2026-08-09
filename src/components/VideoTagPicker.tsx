"use client";

import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { VideoTag } from "@/lib/media";

const RESULT_LIMIT = 60;

export function VideoTagPicker({
  tags,
  selectedIds = [],
  name = "tagIds",
  disabled = false,
}: {
  tags: VideoTag[];
  selectedIds?: number[];
  name?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set(selectedIds));
  const selectedKey = selectedIds.join(",");

  useEffect(() => {
    setSelected(new Set(selectedKey ? selectedKey.split(",").map(Number) : []));
  }, [selectedKey]);

  const filtered = useMemo(() => {
    const terms = query.normalize("NFKC").toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return tags.filter((tag) => terms.every((term) => (
      `${tag.name} ${tag.description}`.normalize("NFKC").toLocaleLowerCase().includes(term)
    ))).slice(0, RESULT_LIMIT);
  }, [query, tags]);

  function toggle(tagId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  return (
    <div className="videoTagPicker">
      {[...selected].map((tagId) => <input name={name} type="hidden" value={tagId} key={tagId} />)}
      <div className="videoTagPickerToolbar">
        <label>
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签" aria-label="搜索视频标签" disabled={disabled} />
        </label>
        {selected.size ? (
          <button type="button" onClick={() => setSelected(new Set())} disabled={disabled} aria-label="清空已选标签" title="清空">
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="videoTagPickerOptions">
        {filtered.map((tag) => {
          const active = selected.has(tag.id);
          return (
            <button className={active ? "isActive" : ""} type="button" onClick={() => toggle(tag.id)} disabled={disabled} aria-pressed={active} key={tag.id}>
              <span className="contentTag">#{tag.name}</span>
            </button>
          );
        })}
        {!filtered.length ? <span className="videoTagPickerEmpty">没有匹配的标签</span> : null}
      </div>
    </div>
  );
}
