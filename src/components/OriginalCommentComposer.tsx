"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OriginalCommentActionState } from "@/app/original/actions";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { countOriginalWords, MAX_ORIGINAL_COMMENT_LENGTH } from "@/lib/original-constants";
import type { AppLocale } from "@/lib/locale";
import { uiText } from "@/lib/locale";
import type { OriginalCommentQuota } from "@/lib/original";

const INITIAL_STATE: OriginalCommentActionState = { ok: false, message: "", version: 0 };

export function OriginalCommentComposer({
  action,
  articleId,
  slug,
  quota,
  locale,
  minChars,
  noticeDisplaySeconds,
}: {
  action: (state: OriginalCommentActionState, formData: FormData) => Promise<OriginalCommentActionState>;
  articleId: number;
  slug: string;
  quota: OriginalCommentQuota;
  locale: AppLocale;
  minChars: number;
  noticeDisplaySeconds: number;
}) {
  const tr = (text: string) => uiText(locale, text);
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const bodyLength = countOriginalWords(body);
  const bodyReady = bodyLength >= minChars;
  const remaining = state.remainingFree === undefined ? quota.remainingFree : state.remainingFree;
  const nextCost = remaining === null ? 0 : remaining > 0 ? 0 : 1;
  const quotaText = quota.freeLimit === null
    ? tr("回复不限额")
    : remaining && remaining > 0
      ? `${tr("今日还可免费回复")} ${remaining} ${tr("条")}`
      : tr("本条回复将扣除 1 苏打");

  useEffect(() => {
    if (!state.ok) return;
    setBody("");
    textareaRef.current?.focus();
    router.refresh();
  }, [router, state.ok, state.version]);

  return (
    <form className="originalCommentComposer" action={formAction}>
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="slug" value={slug} />
      <label>
        <span className="srOnly">{tr("发表评论")}</span>
        <textarea
          ref={textareaRef}
          name="bodyMarkdown"
          rows={3}
          maxLength={MAX_ORIGINAL_COMMENT_LENGTH}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={tr("写下你的回复…")}
          required
          aria-describedby="original-comment-requirement"
        />
      </label>
      <footer>
        <span className="originalCommentQuota" id="original-comment-requirement">{bodyReady ? quotaText : `${tr("回复至少需要")} ${minChars} ${tr("个字符")}`}</span>
        <span className="originalCommentCount">{body.length}/{MAX_ORIGINAL_COMMENT_LENGTH}</span>
        <button className="originalActionButton" type="submit" disabled={pending || !bodyReady} title={tr(nextCost ? "回复并扣除 1 苏打" : "发表回复")}>
          <span>{pending ? tr("发送中") : tr("回复")}</span>
        </button>
      </footer>
      {state.message ? (
        <DismissibleNotice
          key={state.version}
          message={state.message}
          tone={state.ok ? "success" : "error"}
          variant="search"
          displaySeconds={noticeDisplaySeconds}
        />
      ) : null}
    </form>
  );
}
