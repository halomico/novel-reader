/** `prefix` says what kind of total this is. Content search passes a localized "约" when
 *  its total is an upper bound rather than a count. */
export function ResultCount({ count, unit = "本", prefix = "共" }: {
  count: number;
  unit?: string;
  prefix?: string;
}) {
  return (
    <span className="resultCount">
      <span>{prefix}</span>
      <strong>{count.toLocaleString("zh-CN")}</strong>
      <span>{unit}</span>
    </span>
  );
}
