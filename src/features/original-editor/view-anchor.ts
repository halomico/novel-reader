/**
 * Keeping the reader's place when switching between the visual editor, the Markdown
 * source and the preview.
 *
 * A scroll percentage is useless here: the same document is much taller in the source
 * view than in the preview, and a single image or code block shifts everything below
 * it. What all three views do agree on is the *sequence of top-level blocks*, so the
 * position is stored as "block N, F of the way through it" and re-resolved against
 * whichever view is being entered.
 */

export type ViewAnchor = { block: number; fraction: number };

export const TOP_ANCHOR: ViewAnchor = { block: 0, fraction: 0 };

function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/u.test(line);
}

/**
 * The 0-based source line each top-level Markdown block starts on. Blocks are
 * separated by blank lines, except inside a fenced code block where blank lines are
 * content.
 */
export function markdownBlockLines(markdown: string): number[] {
  const lines = String(markdown || "").split("\n");
  const starts: number[] = [];
  let inFence = false;
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFenceLine(line)) {
      if (!inFence && !inBlock) starts.push(index);
      inBlock = true;
      inFence = !inFence;
      if (!inFence) inBlock = false;
      continue;
    }
    if (inFence) continue;
    if (!line.trim()) {
      inBlock = false;
      continue;
    }
    if (!inBlock) {
      starts.push(index);
      inBlock = true;
    }
  }
  return starts.length ? starts : [0];
}

/** Which block contains `line`, and how far into it that line sits. */
export function anchorFromLine(markdown: string, line: number): ViewAnchor {
  const starts = markdownBlockLines(markdown);
  const totalLines = String(markdown || "").split("\n").length;
  let block = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= line) block = index; else break;
  }
  const start = starts[block];
  const end = block + 1 < starts.length ? starts[block + 1] : totalLines;
  const span = Math.max(1, end - start);
  return { block, fraction: clampFraction((line - start) / span) };
}

/** The source line an anchor points at. */
export function lineFromAnchor(markdown: string, anchor: ViewAnchor): number {
  const starts = markdownBlockLines(markdown);
  const totalLines = String(markdown || "").split("\n").length;
  const block = Math.max(0, Math.min(anchor.block, starts.length - 1));
  const start = starts[block];
  const end = block + 1 < starts.length ? starts[block + 1] : totalLines;
  return Math.min(totalLines - 1, start + Math.floor(clampFraction(anchor.fraction) * Math.max(1, end - start)));
}

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The block a scrolling element currently shows at `viewportTop`, in the element's own
 * coordinate space. `blocks` must be the element's top-level children in order.
 */
export function anchorFromBlocks(blocks: ArrayLike<{ offsetTop: number; offsetHeight: number }>, viewportTop: number): ViewAnchor {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const bottom = block.offsetTop + block.offsetHeight;
    if (bottom <= viewportTop) continue;
    const height = Math.max(1, block.offsetHeight);
    return { block: index, fraction: clampFraction((viewportTop - block.offsetTop) / height) };
  }
  return blocks.length ? { block: blocks.length - 1, fraction: 1 } : TOP_ANCHOR;
}

/** The scroll offset that puts `anchor` back at the top of the viewport. */
export function scrollTopFromBlocks(blocks: ArrayLike<{ offsetTop: number; offsetHeight: number }>, anchor: ViewAnchor): number {
  if (!blocks.length) return 0;
  const index = Math.max(0, Math.min(anchor.block, blocks.length - 1));
  const block = blocks[index];
  return Math.max(0, block.offsetTop + clampFraction(anchor.fraction) * block.offsetHeight);
}
