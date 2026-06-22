"use client";

import { ArrowLeft } from "lucide-react";

export function BackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.assign(fallbackHref);
  }

  return (
    <button className="backLink" type="button" onClick={goBack}>
      <ArrowLeft size={18} aria-hidden="true" />
      <span>返回</span>
    </button>
  );
}
