"use client";

import { useEffect } from "react";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Route rendering failed", error);
  }, [error]);

  return (
    <main className="appShell">
      <section className="emptyState" role="alert">
        <h1>页面暂时无法加载</h1>
        <p>请求没有完成。你可以重试；若问题持续，请记下错误编号。</p>
        {error.digest ? <p><code>{error.digest}</code></p> : null}
        <button className="primaryButton" type="button" onClick={reset}>重新加载</button>
      </section>
    </main>
  );
}
