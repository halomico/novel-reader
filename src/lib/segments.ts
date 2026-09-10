export type NovelSegment = {
  segmentIndex: number;
  charStart: number;
  charEnd: number;
  content: string;
};

export type NovelSegmentWindow = {
  segments: NovelSegment[];
  startSegment: number;
  totalChars: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previousContent?: string;
};

const TARGET_SEGMENT_CHARS = 1200;
const MIN_BREAK_CHARS = 700;
export const READER_SEGMENT_WINDOW_SIZE = 20;

export function* iterateNovelSegments(content: string): Generator<NovelSegment> {
  let cursor = 0;
  let segmentIndex = 0;

  while (cursor < content.length) {
    let charEnd = Math.min(cursor + TARGET_SEGMENT_CHARS, content.length);

    if (charEnd < content.length) {
      const preferredBreak = content.lastIndexOf("\n", charEnd);
      if (preferredBreak > cursor + MIN_BREAK_CHARS) {
        charEnd = preferredBreak + 1;
      }
    }

    const segmentContent = content.slice(cursor, charEnd);
    if (segmentContent.trim()) {
      yield {
        segmentIndex,
        charStart: cursor,
        charEnd,
        content: segmentContent,
      };
      segmentIndex += 1;
    }

    cursor = charEnd;
  }
}

function normalizeWindowInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), minimum), maximum);
}

function clipSegmentAtCharEnd(segment: NovelSegment, charEnd: number): NovelSegment | null {
  if (segment.charStart >= charEnd) return null;
  if (segment.charEnd <= charEnd) return segment;

  const targetLength = Math.max(charEnd - segment.charStart, 0);
  let content = segment.content.slice(0, targetLength);
  const paragraphBreak = content.lastIndexOf("\n");
  if (paragraphBreak >= Math.floor(content.length * 0.72)) {
    content = content.slice(0, paragraphBreak + 1);
  }
  return content.trim()
    ? { ...segment, charEnd: segment.charStart + content.length, content }
    : null;
}

/**
 * Builds one bounded reader window without materializing every segment in a book.
 * Segment indexes remain identical to iterateNovelSegments, so persisted progress
 * and search result anchors continue to address the same content.
 */
export function createNovelSegmentWindow(
  content: string,
  options: { startSegment?: number; limit?: number; charEnd?: number } = {},
): NovelSegmentWindow {
  const requestedStart = normalizeWindowInteger(options.startSegment || 0, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = normalizeWindowInteger(options.limit || READER_SEGMENT_WINDOW_SIZE, READER_SEGMENT_WINDOW_SIZE, 1, 100);
  const totalChars = normalizeWindowInteger(options.charEnd ?? content.length, content.length, 0, content.length);
  const selected: NovelSegment[] = [];
  const recent: NovelSegment[] = [];
  let previousContent: string | undefined;
  let hasNext = false;

  for (const sourceSegment of iterateNovelSegments(content)) {
    const segment = clipSegmentAtCharEnd(sourceSegment, totalChars);
    if (!segment) break;

    recent.push(segment);
    if (recent.length > limit + 1) recent.shift();
    if (segment.segmentIndex === requestedStart - 1) previousContent = segment.content;
    if (segment.segmentIndex < requestedStart) continue;
    if (selected.length < limit) {
      selected.push(segment);
      continue;
    }
    hasNext = true;
    break;
  }

  if (selected.length) {
    return {
      segments: selected,
      startSegment: selected[0].segmentIndex,
      totalChars,
      hasPrevious: selected[0].segmentIndex > 0,
      hasNext,
      previousContent,
    };
  }

  // A stale search/progress anchor should land on the final available window,
  // never on an empty reader. This path is intentionally only O(n) for invalid
  // or obsolete anchors; normal windows stop after limit + 1 segments.
  const fallback = recent.slice(-limit);
  return {
    segments: fallback,
    startSegment: fallback[0]?.segmentIndex || 0,
    totalChars,
    hasPrevious: Boolean(fallback[0]?.segmentIndex),
    hasNext: false,
    previousContent: recent.length > fallback.length
      ? recent[recent.length - fallback.length - 1]?.content
      : undefined,
  };
}
