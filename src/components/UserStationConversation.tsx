"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { replyStationThreadInlineAction } from "@/app/messages/actions";
import type { StationMessage } from "@/domains/station/postgres-station";
import { STATION_MESSAGE_MAX_LENGTH, stationMessageLength } from "@/lib/station-protocol";
import { LocalDateTime } from "./LocalDateTime";
import { InlineMutationNotice, useInlineMutation } from "./useInlineMutation";
import { useStationConversationSync } from "./useStationConversationSync";

type UserStationConversationProps = {
  threadId: number;
  initialMessages: StationMessage[];
  initialStatus: "open" | "closed";
  stationDisplayName: string;
  selfLabel: string;
  replyLabel: string;
  placeholder: string;
  sendLabel: string;
  closedLabel: string;
};

function resizeReplyTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "0px";
  const nextHeight = Math.min(textarea.scrollHeight, 120);
  textarea.style.height = `${Math.max(nextHeight, 34)}px`;
  textarea.style.overflowY = textarea.scrollHeight > 120 ? "auto" : "hidden";
}

export function UserStationConversation({
  threadId,
  initialMessages,
  initialStatus,
  stationDisplayName,
  selfLabel,
  replyLabel,
  placeholder,
  sendLabel,
  closedLabel,
}: UserStationConversationProps) {
  const mutation = useInlineMutation();
  const messageListRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [prevThreadId, setPrevThreadId] = useState(threadId);
  const [reply, setReply] = useState("");

  if (prevThreadId !== threadId) {
    setPrevThreadId(threadId);
    setReply("");
  }
  const {
    messages,
    setMessages,
    status,
    setStatus,
    latestMessageIdRef,
  } = useStationConversationSync({
    threadId,
    apiPath: `/api/station/threads/${threadId}`,
    initialMessages,
    initialStatus,
  });

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    resizeReplyTextarea(replyRef.current);
  }, [reply, threadId]);

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stationMessageLength(reply.trim()) > STATION_MESSAGE_MAX_LENGTH) {
      replyRef.current?.setCustomValidity(`消息不能超过 ${STATION_MESSAGE_MAX_LENGTH} 字`);
      replyRef.current?.reportValidity();
      return;
    }
    mutation.run(
      () => replyStationThreadInlineAction(threadId, reply),
      (result) => {
        if (!result.ok || !result.data) return;
        setMessages(result.data.messages);
        setStatus(result.data.status);
        latestMessageIdRef.current = result.data.messages.at(-1)?.id ?? latestMessageIdRef.current;
        setReply("");
        replyRef.current?.focus();
      },
    );
  }

  return (
    <>
      <div className="stationMessageList" ref={messageListRef} aria-live="polite">
        {messages.map((message) => (
          <article className={message.authorRole === "admin" ? "isAdmin" : "isUser"} key={message.id}>
            <header>
              <strong>{message.authorRole === "admin" ? stationDisplayName : selfLabel}</strong>
              <LocalDateTime value={message.createdAt} />
            </header>
            <p>{message.body}</p>
          </article>
        ))}
      </div>
      {status === "open" ? (
        <form className="stationReplyForm" onSubmit={submitReply}>
          <InlineMutationNotice notice={mutation.notice} />
          <label>
            <span className="srOnly">{replyLabel}</span>
            <textarea
              ref={replyRef}
              value={reply}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setReply(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              enterKeyHint="send"
              placeholder={placeholder}
              required
            />
          </label>
          <button type="submit" disabled={mutation.pending || !reply.trim()} aria-label={sendLabel} title={sendLabel}>
            <span className="stationSendLabel">{sendLabel}</span>
          </button>
        </form>
      ) : <p className="stationConversationClosed">{closedLabel}</p>}
    </>
  );
}
