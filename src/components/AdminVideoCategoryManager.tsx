"use client";

import { Eye, EyeOff, Plus, Save, Tags, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  createAdminVideoCategoryAction,
  deleteAdminVideoCategoryAction,
  updateAdminVideoCategoryAction,
} from "@/app/admin/actions";
import { InlineMutationNotice, useInlineMutation } from "@/components/useInlineMutation";
import type { VideoCategory } from "@/lib/media";

export function AdminVideoCategoryManager({ categories, returnPath }: { categories: VideoCategory[]; returnPath: string }) {
  const mutation = useInlineMutation();
  const [items, setItems] = useState(categories);

  useEffect(() => setItems(categories), [categories]);

  function applyCategories(next: VideoCategory[] | undefined) {
    if (!next) return;
    setItems(next);
    window.dispatchEvent(new CustomEvent("admin-video-categories-changed", { detail: { categories: next } }));
  }

  function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    mutation.run(
      () => createAdminVideoCategoryAction(new FormData(form)),
      (result) => {
        applyCategories(result.data?.categories);
        if (result.ok) form.reset();
      },
    );
  }

  function updateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.run(
      () => updateAdminVideoCategoryAction(new FormData(event.currentTarget)),
      (result) => applyCategories(result.data?.categories),
    );
  }

  function deleteCategory(form: HTMLFormElement, category: VideoCategory) {
    if (!window.confirm(`删除分类“${category.name}”？视频文件不会被删除。`)) return;
    mutation.run(
      () => deleteAdminVideoCategoryAction(new FormData(form)),
      (result) => applyCategories(result.data?.categories),
    );
  }

  return (
    <section className="adminTaxonomySection adminVideoCategoryManager">
      <header className="adminTaxonomyHeader">
        <div>
          <h3><Tags size={17} aria-hidden="true" />视频分类</h3>
          <p>分类用于视频页顶部频道导航。</p>
        </div>
        <small>{items.length} 个</small>
      </header>
      <InlineMutationNotice notice={mutation.notice} />
      <form className="adminVideoCategoryCreate" onSubmit={createCategory}>
        <input name="returnPath" type="hidden" value={returnPath} />
        <input name="name" maxLength={24} placeholder="新分类" aria-label="新分类名称" required />
        <button className="adminIconTextButton" type="submit" disabled={mutation.pending}>
          <Plus size={15} aria-hidden="true" />新建
        </button>
      </form>
      {items.length ? (
        <div className="adminVideoCategoryList">
          {items.map((category) => (
            <form className="adminVideoCategoryRow" onSubmit={updateCategory} key={category.id}>
              <input name="returnPath" type="hidden" value={returnPath} />
              <input name="categoryId" type="hidden" value={category.id} />
              <input name="name" maxLength={24} defaultValue={category.name} aria-label={`${category.name}分类名称`} required />
              <label className="adminVideoCategoryOrder">
                <span>排序</span>
                <input name="sortOrder" type="number" min="-9999" max="9999" defaultValue={category.sortOrder} aria-label={`${category.name}排序`} />
              </label>
              <label className="adminVideoCategoryVisibility" title={category.visible ? "前台显示" : "前台隐藏"}>
                <input name="visible" type="checkbox" defaultChecked={category.visible} />
                {category.visible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
                <span>{category.videoCount}</span>
              </label>
              <button className="adminTableIconButton" type="submit" disabled={mutation.pending} aria-label={`保存 ${category.name}`} title="保存">
                <Save size={15} aria-hidden="true" />
              </button>
              <button
                className="adminTableIconButton isDanger"
                type="button"
                disabled={mutation.pending}
                aria-label={`删除 ${category.name}`}
                title="删除分类"
                onClick={(event) => event.currentTarget.form && deleteCategory(event.currentTarget.form, category)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </form>
          ))}
        </div>
      ) : <p className="adminTaxonomyEmpty">暂无分类。</p>}
    </section>
  );
}
