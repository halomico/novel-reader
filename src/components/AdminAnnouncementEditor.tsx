"use client";

import { Save, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent } from "react";
import {
  deleteAnnouncementInlineAction,
  saveAnnouncementInlineAction,
} from "@/app/admin/station/actions";
import type { Announcement } from "@/lib/station";
import { AdminSelect } from "./AdminSelect";
import { InlineMutationNotice, mutationNoticePath, useInlineMutation } from "./useInlineMutation";

function localDateTime(value: string | null): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function AdminAnnouncementEditor({ announcement }: { announcement: Announcement | null }) {
  const router = useRouter();
  const mutation = useInlineMutation();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    mutation.run(
      () => saveAnnouncementInlineAction(formData),
      (result) => {
        if (result.ok) {
          router.push(mutationNoticePath("/admin/station/announcements", result));
        }
      },
    );
  }

  function remove() {
    if (!announcement || !window.confirm(`删除公告“${announcement.title}”？`)) return;
    mutation.run(
      () => deleteAnnouncementInlineAction(announcement.id),
      (result) => {
        if (result.ok) router.push("/admin/station/announcements");
      },
    );
  }

  return (
    <form className="adminAnnouncementComposer" onSubmit={submit}>
      {announcement ? <input name="id" type="hidden" value={announcement.id} /> : null}
      <section className="adminCommerceFormSection">
        <header><h2>公告内容</h2><p>公开公告会出现在首页与公告列表。</p></header>
        <div className="adminCommerceFieldGrid">
          <label className="isFull"><span>标题</span><input name="title" maxLength={80} defaultValue={announcement?.title || ""} required autoFocus /></label>
          <label className="isFull"><span>正文</span><textarea name="body" rows={14} maxLength={4000} defaultValue={announcement?.body || ""} required /><small>支持 Markdown</small></label>
        </div>
      </section>
      <section className="adminCommerceFormSection">
        <header><h2>发布设置</h2></header>
        <div className="adminCommerceFieldGrid">
          <label>
            <span>可见范围</span>
            <AdminSelect name="audience" defaultValue={announcement?.audience || "public"}>
              <option value="public">公开</option>
              <option value="member">登录可见</option>
            </AdminSelect>
          </label>
          <label>
            <span>重要程度</span>
            <AdminSelect name="importance" defaultValue={announcement?.importance || "normal"}>
              <option value="normal">普通</option>
              <option value="important">重要</option>
            </AdminSelect>
          </label>
          <label>
            <span>状态</span>
            <AdminSelect name="status" defaultValue={announcement?.status === "published" ? "published" : "archived"}>
              <option value="published">发布</option>
              <option value="archived">下线</option>
            </AdminSelect>
          </label>
          <label><span>发布时间</span><input name="publishedAt" type="datetime-local" defaultValue={localDateTime(announcement?.publishedAt || null)} /></label>
          <label><span>到期时间</span><input name="expiresAt" type="datetime-local" defaultValue={localDateTime(announcement?.expiresAt || null)} /></label>
        </div>
      </section>
      <footer className="adminCommerceStickyActions">
        <InlineMutationNotice notice={mutation.notice} />
        {announcement ? (
          <button className="adminDangerButton" type="button" onClick={remove} disabled={mutation.pending}>
            <Trash2 size={15} aria-hidden="true" />删除
          </button>
        ) : null}
        <button type="submit" disabled={mutation.pending}>
          {announcement ? <Save size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {announcement ? "保存并返回" : "发布"}
        </button>
      </footer>
    </form>
  );
}
