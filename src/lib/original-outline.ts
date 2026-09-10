export type OriginalOutlineItem = {
  id: string;
  level: number;
  text: string;
};

/**
 * The composer stamps every heading with a stable anchor and writes it into the stored
 * Markdown as `<!-- original-heading:… -->`. Editing surface, preview and reader all
 * resolve the same id from that line, so a link keeps working when headings are
 * reordered, when two headings share a title, and when a title is pure Chinese — none
 * of which a slug or a positional index survives.
 */
export const ORIGINAL_HEADING_ANCHOR_PATTERN = /^<!--\s*original-heading:([A-Za-z0-9_-]{1,80})\s*-->$/u;

/** Positional fallback for content saved before anchors existed, and for previews of
 *  Markdown that has not been through the composer. */
export function originalHeadingId(index: number): string {
  return `original-heading-${Math.max(0, Math.floor(index))}`;
}

function cleanHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<\/?u>/gu, "")
    .replace(/[*_`~]/gu, "")
    .replace(/\\([\\`*_[\]<>])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

export type OriginalHeadingHit = OriginalOutlineItem & { line: number };

/**
 * Extract Markdown headings while ignoring fenced code blocks, reporting the 1-based
 * source line so a renderer can attach the very same id to the element it emits.
 */
export function scanOriginalHeadings(markdown: string): OriginalHeadingHit[] {
  const hits: OriginalHeadingHit[] = [];
  const lines = String(markdown || "").split("\n");
  const used = new Set<string>();
  let inFence = false;
  let pendingAnchor: string | null = null;
  let headingIndex = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      pendingAnchor = null;
      continue;
    }
    if (inFence) continue;
    const anchor = ORIGINAL_HEADING_ANCHOR_PATTERN.exec(line.trim());
    if (anchor) {
      pendingAnchor = anchor[1];
      continue;
    }
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!match) {
      if (line.trim()) pendingAnchor = null;
      continue;
    }
    const text = cleanHeadingText(match[2]);
    let id = pendingAnchor || originalHeadingId(headingIndex);
    // A copied heading carries its anchor along, so ids are made unique here rather
    // than trusting the document to contain no duplicates.
    for (let suffix = 2; used.has(id); suffix += 1) id = `${pendingAnchor || originalHeadingId(headingIndex)}-${suffix}`;
    used.add(id);
    pendingAnchor = null;
    headingIndex += 1;
    if (text) hits.push({ id, level: match[1].length, text, line: index + 1 });
  }
  return hits;
}

export function extractOriginalOutline(markdown: string, maxItems = 200): OriginalOutlineItem[] {
  return scanOriginalHeadings(markdown)
    .slice(0, maxItems)
    .map(({ id, level, text }) => ({ id, level, text }));
}

/** 1-based source line → heading id, for renderers that know a node's position. */
export function originalHeadingIdsByLine(markdown: string): Map<number, string> {
  return new Map(scanOriginalHeadings(markdown).map((hit) => [hit.line, hit.id]));
}
