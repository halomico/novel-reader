import Link from "@/components/LocalizedLink";

export default function NotFound() {
  return (
    <main className="appShell">
      <section className="emptyState" style={{ minHeight: "60vh", display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>页面未找到 (404)</h1>
          <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>您请求的页面不存在或已被移除。</p>
          <Link href="/" className="primaryButton" style={{ display: "inline-block", padding: "8px 20px" }}>
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
