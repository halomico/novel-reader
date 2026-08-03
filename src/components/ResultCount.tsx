export function ResultCount({ count, unit = "本" }: { count: number; unit?: string }) {
  return (
    <span className="resultCount">
      <span>共</span>
      <strong>{count.toLocaleString("zh-CN")}</strong>
      <span>{unit}</span>
    </span>
  );
}
