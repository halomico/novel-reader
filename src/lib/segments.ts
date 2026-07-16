export type NovelSegment = {
  segmentIndex: number;
  charStart: number;
  charEnd: number;
  content: string;
};

const TARGET_SEGMENT_CHARS = 1200;
const MIN_BREAK_CHARS = 700;

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

export function createNovelSegments(content: string): NovelSegment[] {
  return Array.from(iterateNovelSegments(content));
}
