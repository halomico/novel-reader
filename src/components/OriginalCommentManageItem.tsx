"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "@/components/LocalizedLink";
import type { OriginalCommentActivity } from "@/lib/original";
import { OriginalMarkdown } from "./OriginalMarkdown";
import { UserAvatar } from "./UserAvatar";

type CommentAction = (formData: FormData) => void | Promise<void>;

export function OriginalCommentManageItem({
  comment,
  displayDate,
  editAction,
  deleteAction,
  labels,
}: {
  comment: OriginalCommentActivity;
  displayDate: string;
  editAction: CommentAction;
  deleteAction: CommentAction;
  labels: { edit: string; save: string; cancel: string; remove: string; confirmRemove: string; hidden: string };
}) {
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !editorRef.current) return;
    const editor = editorRef.current;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }, [editing]);

  return (
    <article className="originalMineCommentItem">
      <header>
        <span className="originalMineCommentAuthorLine">
          <UserAvatar className="originalCommentAvatar" userId={comment.authorId} displayName={comment.authorName} avatarPath={comment.authorAvatarPath} />
          <span>
            <strong>{comment.authorName}</strong>
            <small><time dateTime={comment.createdAt}>{displayDate}</time> · <Link href={`/original/${comment.articleSlug}`}>{comment.articleTitle}</Link></small>
          </span>
        </span>
        <div className="originalMineCommentActions">
          {!editing ? <button type="button" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden="true" />{labels.edit}</button> : null}
          <form action={deleteAction} onSubmit={(event) => { if (!window.confirm(labels.confirmRemove)) event.preventDefault(); }}>
            <input type="hidden" name="commentId" value={comment.id} />
            <button type="submit"><Trash2 size={13} aria-hidden="true" />{labels.remove}</button>
          </form>
        </div>
      </header>
      {editing ? (
        <form className="originalMineCommentEdit" action={editAction}>
          <input type="hidden" name="commentId" value={comment.id} />
          <textarea ref={editorRef} name="bodyMarkdown" maxLength={200} defaultValue={comment.bodyMarkdown} required />
          <div>
            <button type="submit"><Pencil size={13} aria-hidden="true" />{labels.save}</button>
            <button type="button" onClick={() => setEditing(false)}>{labels.cancel}</button>
          </div>
        </form>
      ) : (
        <div><OriginalMarkdown>{comment.bodyMarkdown}</OriginalMarkdown></div>
      )}
      {comment.status === "hidden" ? <small className="originalMineCommentStatus">{labels.hidden}</small> : null}
    </article>
  );
}
