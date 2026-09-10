"use client";

import { useEffect, useRef, useState } from "react";
import type { StationMessage } from "@/domains/station/postgres-station";

type StationStatus = "open" | "closed";

type StationConversationSyncOptions = {
  threadId: number;
  apiPath: string;
  initialMessages: StationMessage[];
  initialStatus: StationStatus;
};

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

function mergeStationMessages(current: StationMessage[], incoming: StationMessage[]) {
  if (!incoming.length) return current;

  const knownIds = new Set(current.map((message) => message.id));
  const nextMessages = current.slice();
  let changed = false;

  for (const message of incoming) {
    if (knownIds.has(message.id)) continue;
    knownIds.add(message.id);
    nextMessages.push(message);
    changed = true;
  }

  return changed ? nextMessages : current;
}

export function useStationConversationSync({
  threadId,
  apiPath,
  initialMessages,
  initialStatus,
}: StationConversationSyncOptions) {
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState<StationStatus>(initialStatus);
  const latestMessageIdRef = useRef(initialMessages.at(-1)?.id ?? 0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const delayRef = useRef(BASE_DELAY_MS);

  useEffect(() => {
    setMessages(initialMessages);
    setStatus(initialStatus);
    latestMessageIdRef.current = initialMessages.at(-1)?.id ?? 0;
    delayRef.current = BASE_DELAY_MS;
  // Initial props are a snapshot for this conversation. Do not reset the
  // live list when a parent re-renders with a new array identity; that would
  // discard messages received by an in-flight incremental poll.
  }, [threadId]);

  useEffect(() => {
    if (status === "closed") {
      return;
    }

    let disposed = false;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = (delay: number) => {
      if (disposed) return;
      clearTimer();
      timerRef.current = setTimeout(() => {
        void syncConversation();
      }, delay);
    };

    const syncConversation = async () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const afterId = latestMessageIdRef.current;
      const requestPath = afterId > 0 ? `${apiPath}?afterId=${afterId}` : apiPath;

      try {
        const response = await fetch(requestPath, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = await response.json() as {
          messages?: StationMessage[];
          status?: StationStatus;
        };

        if (disposed || controller.signal.aborted) return;

        if (Array.isArray(payload.messages)) {
          setMessages((current) => {
            const nextMessages = mergeStationMessages(current, payload.messages!);
            latestMessageIdRef.current = nextMessages.at(-1)?.id ?? latestMessageIdRef.current;
            return nextMessages;
          });
        }
        if (payload.status) {
          setStatus(payload.status);
          if (payload.status === "closed") {
            return;
          }
        }

        delayRef.current = BASE_DELAY_MS;
        schedule(BASE_DELAY_MS);
      } catch {
        if (disposed || controller.signal.aborted) return;
        delayRef.current = Math.min(delayRef.current * 2, MAX_DELAY_MS);
        schedule(delayRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        abortRef.current?.abort();
        clearTimer();
        return;
      }

      delayRef.current = BASE_DELAY_MS;
      schedule(0);
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      if (document.visibilityState === "hidden") {
        clearTimer();
      } else {
        schedule(BASE_DELAY_MS);
      }
    } else {
      schedule(BASE_DELAY_MS);
    }

    return () => {
      disposed = true;
      abortRef.current?.abort();
      clearTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [apiPath, status, threadId]);

  return {
    messages,
    setMessages,
    status,
    setStatus,
    latestMessageIdRef,
  };
}
