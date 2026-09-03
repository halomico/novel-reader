"use client";

export default function OriginalComposerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}><section><h1>写作空间暂时无法打开</h1><p>本机恢复副本不会因本页面错误被主动删除。</p><button type="button" onClick={reset}>重新载入</button></section></main>;
}
