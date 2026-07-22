export function ResultCount({ count }: { count: number }) {
  return (
    <span className="resultCount">
      <span>共</span>
      <strong>{count.toLocaleString("zh-CN")}</strong>
      <span>本</span>
    </span>
  );
}
