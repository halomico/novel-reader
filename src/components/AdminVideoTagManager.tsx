"use client";

import { ChevronDown, Eye, EyeOff, Plus, Save, Search, Tag, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createAdminVideoTagAction,
  deleteAdminVideoTagAction,
  updateAdminVideoTagAction,
} from "@/app/admin/actions";
import { InlineMutationNotice, useInlineMutation } from "@/components/useInlineMutation";
import type { VideoTag } from "@/lib/media";

const VISIBLE_LIMIT = 80;

export function AdminVideoTagManager({ tags, returnPath }: { tags: VideoTag[]; returnPath: string }) {
  const mutation = useInlineMutation();
  const [items, setItems] = useState(tags);
  const [query, setQuery] = useState("");

  useEffect(() => setItems(tags), [tags]);

  const filtered = useMemo(() => {
    const terms = query.normalize("NFKC").toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return items.filter((tag) => terms.every((term) => (
      `${tag.name} ${tag.description}`.normalize("NFKC").toLocaleLowerCase().includes(term)
    )));
  }, [items, query]);
  const visibleItems = filtered.slice(0, VISIBLE_LIMIT);

  function applyTags(next: VideoTag[] | undefined) {
    if (next) setItems(next);
  }

  function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    mutation.run(
      () => createAdminVideoTagAction(new FormData(form)),
      (result) => {
        applyTags(result.data?.tags);
        if (result.ok) form.reset();
      },
    );
  }

  function updateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.run(
      () => updateAdminVideoTagAction(new FormData(event.currentTarget)),
      (result) => applyTags(result.data?.tags),
    );
  }

  function deleteTag(form: HTMLFormElement, tag: VideoTag) {
    if (!window.confirm(`删除标签“${tag.name}”？视频文件不会被删除。`)) return;
    mutation.run(
      () => deleteAdminVideoTagAction(new FormData(form)),
      (result) => applyTags(result.data?.tags),
    );
  }

  return (
    <section className="adminTaxonomySection adminVideoTagManager">
      <header className="adminTaxonomyHeader">
        <div>
          <h3><Tag size={17} aria-hidden="true" />视频标签</h3>
          <p>用于筛选与内容关联，不显示作者或头像。</p>
        </div>
        <label className="adminTaxonomySearch">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签" aria-label="搜索视频标签" />
        </label>
      </header>
      <InlineMutationNotice notice={mutation.notice} />

      <form className="adminVideoTagCreate" onSubmit={createTag}>
        <input name="returnPath" type="hidden" value={returnPath} />
        <label>
          <span>名称</span>
          <input name="name" maxLength={40} placeholder="新标签" required />
        </label>
        <label>
          <span>描述</span>
          <input name="description" maxLength={500} placeholder="可选" />
        </label>
        <button className="adminIconTextButton" type="submit" disabled={mutation.pending}>
          <Plus size={15} aria-hidden="true" />新建
        </button>
      </form>

      <div className="adminVideoTagList">
        {visibleItems.map((tag) => (
          <details className="adminVideoTagRow" key={tag.id}>
            <summary>
              <span className="contentTag">#{tag.name}</span>
              <small>{tag.videoCount} 个视频</small>
              {tag.visible ? <Eye size={15} aria-label="前台显示" /> : <EyeOff size={15} aria-label="前台隐藏" />}
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <form onSubmit={updateTag}>
              <input name="returnPath" type="hidden" value={returnPath} />
              <input name="tagId" type="hidden" value={tag.id} />
              <label>
                <span>名称</span>
                <input name="name" maxLength={40} defaultValue={tag.name} required />
              </label>
              <label className="adminVideoTagDescription">
                <span>描述</span>
                <textarea name="description" maxLength={500} rows={3} defaultValue={tag.description} />
              </label>
              <label className="adminVideoTagOrder">
                <span>排序</span>
                <input name="sortOrder" type="number" min="-9999" max="9999" defaultValue={tag.sortOrder} />
              </label>
              <label className="adminSwitchLabel">
                <input name="visible" type="checkbox" defaultChecked={tag.visible} />
                <span className="adminSwitchTrack" aria-hidden="true" />
                前台显示
              </label>
              <div className="adminVideoTagActions">
                <button className="adminTableIconButton" type="submit" disabled={mutation.pending} aria-label={`保存 ${tag.name}`} title="保存">
                  <Save size={15} aria-hidden="true" />
                </button>
                <button
                  className="adminTableIconButton isDanger"
                  type="button"
                  disabled={mutation.pending}
                  aria-label={`删除 ${tag.name}`}
                  title="删除标签"
                  onClick={(event) => event.currentTarget.form && deleteTag(event.currentTarget.form, tag)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </form>
          </details>
        ))}
      </div>
      {!filtered.length ? <p className="adminTaxonomyEmpty">没有匹配的标签。</p> : null}
      {filtered.length > visibleItems.length ? (
        <p className="adminTaxonomyLimit">当前显示前 {VISIBLE_LIMIT} 个结果，请继续输入关键词缩小范围。</p>
      ) : null}
    </section>
  );
}
