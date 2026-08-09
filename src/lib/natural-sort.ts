const NUMBER_TOKEN = /\d+/g;

export function naturalSortKey(value: unknown): string {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-CN");
  return normalized.replace(NUMBER_TOKEN, (digits) => {
    const significant = digits.replace(/^0+(?=\d)/, "");
    const numericLength = String(significant.length).padStart(6, "0");
    const originalLength = String(digits.length).padStart(6, "0");
    return `\u0001${numericLength}:${significant}\u0002${originalLength}:`;
  });
}
