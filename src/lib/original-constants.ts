/** Shared with the client composer; keep this module free of server imports. */
export const MAX_ORIGINAL_BODY_LENGTH = 200_000;
export const MAX_ORIGINAL_COMMENT_LENGTH = 200;

/** Markdown comment used by the composer to split the public and paid sections. */
export const ORIGINAL_PAID_MARKER = "<!-- original-paid -->";

/** Count visible characters the same way the novel catalog counts words. */
export function countOriginalWords(value: string): number {
  return Array.from(String(value || "").replace(/\s+/gu, "")).length;
}

/** Original tags intentionally use a compact, predictable vocabulary: a
 * short Chinese phrase or one ASCII word. Keep this client-safe so the editor
 * and the server enforce exactly the same rule. */
export function normalizeOriginalTagName(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim();
}

export function isValidOriginalTagName(value: unknown): boolean {
  const tag = normalizeOriginalTagName(value);
  return /^\p{Script=Han}{2,6}$/u.test(tag) || /^[A-Za-z]{2,15}$/.test(tag);
}

/** Tag slugs keep their Han characters, unlike article slugs, which are transliterated
 * to ASCII. Routing a Chinese tag through the article rule collapsed every name to the
 * same `article-<timestamp>` fallback, so tag URLs were neither stable nor readable.
 * Both writers of `original_tags.slug` must use this one function. */
export function originalTagSlug(name: string): string {
  return normalizeOriginalTagName(name)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "tag";
}

/** Markdown treats four leading ASCII spaces as a code block. Original
 * articles favor authored prose indentation, while explicit fenced blocks
 * remain available for code. Convert only plain-line indentation to visible
 * spaces before parsing so the writer's source layout survives rendering. */
export function preserveOriginalMarkdownSpacing(value: string): string {
  let inFence = false;
  return String(value || "").split(/\r?\n/u).map((line) => {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence || !/^[ \t]+\S/u.test(line)) return line;
    const content = line.trimStart();
    if (/^(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|<!--|\|)/u.test(content)) return line;
    // Four leading spaces are valid Markdown for an indented code block.
    // Preserve them instead of turning code into a non-breaking-space paragraph.
    const leading = line.slice(0, line.length - content.length);
    const indentWidth = Array.from(leading).reduce((width, character) => width + (character === "\t" ? 4 : 1), 0);
    if (indentWidth >= 4) return line;
    const indent = leading
      .replace(/ /gu, "\u00a0")
      .replace(/\t/gu, "\u00a0\u00a0");
    return `${indent}${content}`;
  }).join("\n");
}

export function composeOriginalEditorBody(publicBody: string, paidBody: string): string {
  if (!paidBody) return publicBody;
  const left = publicBody && !publicBody.endsWith("\n") ? `${publicBody}\n` : publicBody;
  const right = paidBody && !paidBody.startsWith("\n") ? `\n${paidBody}` : paidBody;
  return `${left}${ORIGINAL_PAID_MARKER}${right}`;
}

/**
 * Join the two stored sections back into one document. The paid boundary is not a
 * character in either section, so a block separator has to be supplied here — without
 * it the public part's last line and the paid part's first line ran together, which
 * turned the paid section's heading anchor into inline text and broke every table of
 * contents link into the paid half. Sections that already end or start with blank
 * lines keep exactly the spacing the writer chose.
 */
export function joinOriginalBodies(publicBody: string, paidBody: string): string {
  const left = publicBody || "";
  const right = paidBody || "";
  if (!left || !right) return `${left}${right}`;
  const trailing = /\n\s*\n\s*$/u.test(left);
  const leading = /^\s*\n\s*\n/u.test(right);
  return trailing || leading ? `${left}${right}` : `${left}\n\n${right}`;
}

/** Insert a Markdown block on its own line while preserving every existing
 * line break around the selection. The cursor lands on the following line. */
export function insertOriginalEditorBlock(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  block: string,
): { value: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  let end = Math.max(start, Math.min(selectionEnd, value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  if (after.startsWith("\n")) end += 1;
  const replacement = `${prefix}${block}\n`;
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    cursor: start + replacement.length,
  };
}
