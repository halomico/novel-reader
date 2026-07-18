"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";
import type { HumanVerificationPurpose } from "@/lib/human-verification";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, string>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function HumanVerificationField({ siteKey, purpose }: { siteKey: string | null; purpose: HumanVerificationPurpose }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const renderWidget = useCallback(() => {
    if (!siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: purpose,
      theme: "auto",
      size: "flexible",
    });
  }, [purpose, siteKey]);

  useEffect(() => () => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.remove(widgetIdRef.current);
    }
  }, []);

  if (!siteKey) {
    return null;
  }

  return (
    <div className="humanVerificationField">
      <Script
        id="cloudflare-turnstile-api"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderWidget}
        onReady={renderWidget}
      />
      <div ref={containerRef} />
    </div>
  );
}
