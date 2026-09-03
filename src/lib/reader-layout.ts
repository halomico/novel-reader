export const READER_LAYOUT_CHANGE_EVENT = "novel-reader:layout-change";
export const READER_PAGE_TURN_CHANGE_EVENT = "novel-reader:page-turn-change";
export const READER_PAGE_REQUEST_EVENT = "novel-reader:page-request";
export const READER_PAGE_STATE_EVENT = "novel-reader:page-state";
export const READER_PAGE_STATE_REQUEST_EVENT = "novel-reader:page-state-request";
export const READER_CHROME_SHOW_EVENT = "novel-reader:chrome-show";
export const READER_KEEP_CHROME_SESSION_KEY = "novel-reader:keep-chrome";
export const READER_ENTRY_EDGE_SESSION_KEY = "novel-reader:entry-edge";

export type ReaderPageState = {
  paged: boolean;
  index: number;
  count: number;
  canPrevious: boolean;
  canNext: boolean;
};

export function resolveReaderPageMetrics({
  viewportWidth,
  scrollWidth,
  scrollLeft,
  pageGap,
}: {
  viewportWidth: number;
  scrollWidth: number;
  scrollLeft: number;
  pageGap: number;
}): { count: number; index: number; stride: number } {
  const width = Math.max(Number.isFinite(viewportWidth) ? viewportWidth : 0, 1);
  const gap = Math.max(Number.isFinite(pageGap) ? pageGap : 0, 0);
  const stride = width + gap;
  const contentWidth = Math.max(Number.isFinite(scrollWidth) ? scrollWidth : 0, width);
  const count = Math.max(1, Math.ceil((contentWidth + gap) / stride - 0.01));
  const index = Math.min(Math.max(Math.round(scrollLeft / stride), 0), count - 1);
  return { count, index, stride };
}

export function resolveReaderDragTarget({
  startIndex,
  distance,
  velocity,
  stride,
  pageCount,
}: {
  startIndex: number;
  distance: number;
  velocity: number;
  stride: number;
  pageCount: number;
}): number {
  const threshold = Math.min(64, Math.max(stride, 1) * 0.16);
  const intentionalTurn = Math.abs(distance) >= threshold || Math.abs(velocity) >= 0.35;
  if (!intentionalTurn) return startIndex;
  return Math.min(Math.max(startIndex + (distance > 0 ? 1 : -1), -1), pageCount);
}

export type ReaderParagraph = {
  text: string;
  continued: boolean;
  sectionHeading: boolean;
};

const SECTION_HEADING_PATTERN = /^(?:序章|楔子|引子|前言|后记|尾声|终章|番外(?:篇)?|第[0-9零一二三四五六七八九十百千万两]+[章节卷部篇回集](?:\s+.{1,24})?)$/u;

export function splitReaderParagraphs(content: string, continuedFromPrevious = false): ReaderParagraph[] {
  return content
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      text,
      continued: continuedFromPrevious && index === 0,
      sectionHeading: SECTION_HEADING_PATTERN.test(text),
    }));
}
