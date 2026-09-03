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
    const indent = line.slice(0, line.length - content.length)
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

/** Join the two stored sections exactly as authored; the paid marker line is
 * already represented by the surrounding newlines in the stored sections. */
export function joinOriginalBodies(publicBody: string, paidBody: string): string {
  return `${publicBody || ""}${paidBody || ""}`;
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
