"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OriginalCommentActionState } from "@/app/original/actions";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { ReaderSidePanel } from "@/components/ReaderChrome";
import { countOriginalWords, MAX_ORIGINAL_COMMENT_LENGTH } from "@/lib/original-constants";
import type { AppLocale } from "@/lib/locale";
import { uiText } from "@/lib/locale";
import type { OriginalCommentQuota } from "@/domains/originals/original-model";
import { OPEN_ORIGINAL_COMMENT_COMPOSER_EVENT } from "@/lib/original-comments";

const INITIAL_STATE: OriginalCommentActionState = { ok: false, message: "", version: 0 };

export function OriginalCommentComposer({
  action,
  articleId,
  slug,
  quota,
  locale,
  minChars,
  noticeDisplaySeconds,
  showTrigger = true,
}: {
  action: (state: OriginalCommentActionState, formData: FormData) => Promise<OriginalCommentActionState>;
  articleId: number;
  slug: string;
  quota: OriginalCommentQuota;
  locale: AppLocale;
  minChars: number;
  noticeDisplaySeconds: number;
  showTrigger?: boolean;
}) {
  const tr = (text: string) => uiText(locale, text);
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    setOpen(false);
    router.refresh();
  }, [router, state.ok, state.version]);

  useEffect(() => {
    const openComposer = (event: Event) => {
      const detail = (event as CustomEvent<{ articleId?: number }>).detail;
      if (!detail?.articleId || detail.articleId === articleId) setOpen(true);
    };
    window.addEventListener(OPEN_ORIGINAL_COMMENT_COMPOSER_EVENT, openComposer);
    return () => window.removeEventListener(OPEN_ORIGINAL_COMMENT_COMPOSER_EVENT, openComposer);
  }, [articleId]);

  return (
    <>
      {showTrigger ? <button
        className="originalActionButton originalCommentReplyButton"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {tr("回复")}
      </button> : null}
      {open ? (
        <ReaderSidePanel kind="reply" title={tr("发表回复")} onClose={() => setOpen(false)}>
          <form className="originalCommentComposer" action={formAction}>
            <input type="hidden" name="articleId" value={articleId} />
            <input type="hidden" name="slug" value={slug} />
            <label>
              <span className="srOnly">{tr("发表评论")}</span>
              <textarea
                name="bodyMarkdown"
                rows={6}
                maxLength={MAX_ORIGINAL_COMMENT_LENGTH}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={tr("写下你的回复…")}
                required
                autoFocus
                aria-describedby="original-comment-requirement"
              />
            </label>
            {state.message && !state.ok ? (
              <DismissibleNotice
                key={state.version}
                message={state.message}
                tone="error"
                variant="search"
                displaySeconds={noticeDisplaySeconds}
              />
            ) : null}
            <footer>
              <span className="originalCommentQuota" id="original-comment-requirement">
                {bodyReady ? quotaText : `${tr("回复至少需要")} ${minChars} ${tr("个字符")}`}
              </span>
              <span className="originalCommentCount">{body.length}/{MAX_ORIGINAL_COMMENT_LENGTH}</span>
              <button
                className="originalActionButton"
                type="submit"
                disabled={pending || !bodyReady}
                title={tr(nextCost ? "回复并扣除 1 苏打" : "发表回复")}
              >
                <span>{pending ? tr("发送中") : tr("回复")}</span>
              </button>
            </footer>
          </form>
        </ReaderSidePanel>
      ) : null}
    </>
  );
}
