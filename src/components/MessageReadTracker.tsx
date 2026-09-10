"use client";

import { useEffect } from "react";
import { jsonMutationRequest } from "@/core/security/browser-mutation";
import { WORKSPACE_MESSAGES_READ_EVENT } from "./UserWorkspaceRouteState";

export function MessageReadTracker({ threadId }: { threadId?: number }) {
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    void fetch("/api/messages/read", jsonMutationRequest({
      method: "POST",
      body: JSON.stringify(threadId ? { threadId } : {}),
      signal: controller.signal,
    }))
      .then((response) => {
        if (response.ok && !disposed) {
          window.dispatchEvent(new Event(WORKSPACE_MESSAGES_READ_EVENT));
        }
      })
      .catch(() => {
        // Read state is best effort; navigation must never be blocked by it.
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [threadId]);

  return null;
}
