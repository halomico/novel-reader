"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Application shell rendering failed", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f7f5", color: "#20201e" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, boxSizing: "border-box" }}>
          <section role="alert" style={{ maxWidth: 520, textAlign: "center" }}>
            <h1>应用暂时无法加载</h1>
            <p>请重试；若问题持续，可刷新页面或稍后再来。</p>
            {error.digest ? <p><code>{error.digest}</code></p> : null}
            <button type="button" onClick={reset} style={{ padding: "10px 18px", cursor: "pointer" }}>重试</button>
          </section>
        </main>
      </body>
    </html>
  );
}
