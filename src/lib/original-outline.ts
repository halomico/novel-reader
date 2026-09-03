export type OriginalOutlineItem = {
  id: string;
  level: number;
  text: string;
};

/** Stable ids shared by the Markdown renderer and the outline navigation. */
export function originalHeadingId(index: number): string {
  return `original-heading-${Math.max(0, Math.floor(index))}`;
}

function cleanHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_`~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Extract Markdown headings while ignoring fenced code blocks. */
export function extractOriginalOutline(markdown: string, maxItems = 40): OriginalOutlineItem[] {
  const items: OriginalOutlineItem[] = [];
  let inFence = false;
  let headingIndex = 0;
  for (const line of String(markdown || "").split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!match) continue;
    const text = cleanHeadingText(match[2]);
    const id = originalHeadingId(headingIndex);
    headingIndex += 1;
    if (text && items.length < maxItems) items.push({ id, level: match[1].length, text });
  }
  return items;
}
