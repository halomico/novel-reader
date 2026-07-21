"use client";

import { useEffect } from "react";

export function SearchEventUrlSync({ eventKey }: { eventKey: string | null }) {
  useEffect(() => {
    if (!eventKey) return;

    const url = new URL(window.location.href);
    if (url.searchParams.get("searchEvent") === eventKey) return;

    url.searchParams.set("searchEvent", eventKey);
    window.history.replaceState(null, "", url.toString());
  }, [eventKey]);

  return null;
}
