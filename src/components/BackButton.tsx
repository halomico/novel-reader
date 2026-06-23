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
    <button className="backLink" type="button" onClick={goBack} aria-label="返回" title="返回">
      <ArrowLeft size={18} aria-hidden="true" />
    </button>
  );
}
