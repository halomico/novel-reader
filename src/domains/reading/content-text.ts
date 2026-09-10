/** Bump whenever Unicode processing, OpenCC dictionaries or matching rules change. */
export const CONTENT_NORMALIZATION_VERSION = 2;
export const MAX_NORMALIZED_CONTENT_QUERY_CHARS = 50;
export const CONTENT_BLOCK_CODE_POINTS = 1_200;

export type SearchTextMode = "title" | "content" | "phrase";
export type TextPosition = { text: string; start: number; end: number };
export type ChineseSearchForms = { original: string; hans: string | null; version: number };
export type ContentBlock = {
  blockNo: number;
  charStart: number;
  charEnd: number;
  originalText: string;
  searchWindowStart: number;
  searchWindowEnd: number;
  searchTextOriginal: string;
  searchTextHans: string | null;
};

type Trie = { children: Map<string, Trie>; value?: string };
let dictionaries: Promise<Trie[]> | undefined;

/** OpenCC ships each locale as nested groups that bottom out in "src tgt|src tgt"
 *  strings (the phrase table, then the single-character table). That nesting depth is
 *  not part of its public API, so walk it rather than assume one fixed shape: reading
 *  it as a flat list destructured every dictionary *string* into its first two
 *  characters, which built a two-entry trie and left every converted form identical
 *  to its input, so `hans` was always null. */
function collectDictionaryEntries(dictionary: unknown, entries: [string, string][]): void {
  if (typeof dictionary === "string") {
    for (const line of dictionary.split("|")) {
      const separator = line.indexOf(" ");
      if (separator < 1) continue;
      const source = line.slice(0, separator);
      const target = line.slice(separator + 1).trim();
      if (source && target) entries.push([source, target]);
    }
    return;
  }
  if (!Array.isArray(dictionary)) return;
  // An already-parsed [source, target] pair, as opposed to a group of tables.
  if (dictionary.length === 2
    && dictionary.every((value) => typeof value === "string")
    && !dictionary.some((value) => (value as string).includes("|") || (value as string).includes(" "))) {
    entries.push([dictionary[0] as string, dictionary[1] as string]);
    return;
  }
  for (const item of dictionary) collectDictionaryEntries(item, entries);
}

function buildTrie(group: unknown): Trie {
  const entries: [string, string][] = [];
  collectDictionaryEntries(group, entries);
  if (!entries.length) throw new Error("OpenCC dictionary produced no entries; its bundled layout changed");
  const root: Trie = { children: new Map() };
  for (const [source, target] of entries) {
    let node = root;
    for (const char of source) {
      let child = node.children.get(char);
      if (!child) { child = { children: new Map() }; node.children.set(char, child); }
      node = child;
    }
    node.value = target;
  }
  return root;
}

function loadDictionaries(): Promise<Trie[]> {
  dictionaries ||= import("opencc-js/t2cn").then((module) => {
    // Use the pinned OpenCC dictionary and longest-match algorithm, keeping the
    // source ranges that its string-only public converter necessarily discards.
    const { Locale } = module as unknown as { Locale: { from: { tw: unknown }; to: { cn: unknown } } };
    return [Locale.from.tw, Locale.to.cn].map(buildTrie);
  });
  return dictionaries;
}

function assertSourceText(text: string): void {
  // PostgreSQL rejects U+0000; reject invalid UTF-16 too instead of silently
  // replacing a surrogate while retaining now-invalid source coordinates.
  if (text.includes("\0") || !text.isWellFormed()) throw new Error("Content must contain valid Unicode without U+0000");
}

function unicodePositions(text: string): TextPosition[] {
  assertSourceText(text);
  const output: TextPosition[] = [];
  for (const part of new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)) {
    for (const char of part.segment.normalize("NFKC").toLowerCase()) {
      output.push({ text: char, start: part.index, end: part.index + part.segment.length });
    }
  }
  return output;
}

function convertPositions(input: TextPosition[], tries: Trie[]): TextPosition[] {
  return tries.reduce((positions, trie) => {
    const output: TextPosition[] = [];
    for (let i = 0; i < positions.length;) {
      let node = trie;
      let matchedEnd = i;
      let replacement: string | undefined;
      for (let j = i; j < positions.length; j += 1) {
        const next = node.children.get(positions[j].text);
        if (!next) break;
        node = next;
        if (node.value !== undefined) { matchedEnd = j + 1; replacement = node.value; }
      }
      if (replacement !== undefined) {
        for (const char of replacement) output.push({ text: char, start: positions[i].start, end: positions[matchedEnd - 1].end });
        i = matchedEnd;
      } else { output.push(positions[i]); i += 1; }
    }
    return output;
  }, input);
}

function filterPositions(input: TextPosition[], mode: SearchTextMode): TextPosition[] {
  if (mode === "title") return input;
  const output: TextPosition[] = [];
  for (const position of input) {
    if (/[\p{P}\p{S}]/u.test(position.text)) continue;
    if (/\s/u.test(position.text)) {
      if (mode === "phrase" && output.length) {
        const previous = output.at(-1)!;
        if (previous.text === " ") previous.end = position.end;
        else output.push({ ...position, text: " " });
      }
    } else output.push({ ...position });
  }
  if (output.at(-1)?.text === " ") output.pop();
  return output;
}

export async function normalizeChineseSearchPositions(text: string, mode: SearchTextMode = "content") {
  const original = unicodePositions(text);
  const hans = convertPositions(original, await loadDictionaries());
  return { original: filterPositions(original, mode), hans: filterPositions(hans, mode) };
}

export async function normalizeChineseSearchForms(text: string, mode: SearchTextMode = "content"): Promise<ChineseSearchForms> {
  const positions = await normalizeChineseSearchPositions(text, mode);
  const original = positions.original.map((position) => position.text).join("");
  const hans = positions.hans.map((position) => position.text).join("");
  return { original, hans: original === hans ? null : hans, version: CONTENT_NORMALIZATION_VERSION };
}

export async function normalizeContentQueryTerm(text: string, mode: "content" | "phrase" = "content"): Promise<ChineseSearchForms> {
  const forms = await normalizeChineseSearchForms(text, mode);
  for (const value of [forms.original, forms.hans ?? forms.original]) {
    const length = Array.from(value).length;
    if (length === 0 || length > MAX_NORMALIZED_CONTENT_QUERY_CHARS) {
      throw new Error(`Normalized content query must contain 1–${MAX_NORMALIZED_CONTENT_QUERY_CHARS} characters`);
    }
  }
  return forms;
}

function lowerBound(positions: TextPosition[], offset: number, field: "start" | "end", inclusive: boolean): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (positions[middle][field] < offset || (inclusive && positions[middle][field] === offset)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Nonoverlapping original bodies retain a normalized boundary context, so
 * punctuation, whitespace, and length-changing Chinese conversion cannot hide
 * a term that crosses adjacent index blocks.
 */
export async function* createContentBlocks(text: string, blockCodePoints = CONTENT_BLOCK_CODE_POINTS): AsyncGenerator<ContentBlock> {
  if (!Number.isSafeInteger(blockCodePoints) || blockCodePoints < 1 || blockCodePoints > 4_096) throw new Error("Invalid content block size");
  const forms = await normalizeChineseSearchPositions(text);
  const contextChars = MAX_NORMALIZED_CONTENT_QUERY_CHARS - 1;
  let start = 0;
  let end = 0;
  let count = 0;
  let blockNo = 0;
  function block(charStart: number, charEnd: number): ContentBlock {
    const contexts = [forms.original, forms.hans].map((positions) => {
      const first = Math.max(0, lowerBound(positions, charStart, "end", true) - contextChars);
      const last = Math.min(positions.length, lowerBound(positions, charEnd, "start", false) + contextChars);
      return positions.slice(first, last);
    });
    // Both forms use the union of source windows, including length-changing
    // conversions, so every simple keyword sees the same source range.
    const searchWindowStart = Math.min(charStart, ...contexts.map((context) => context[0]?.start ?? charStart));
    const searchWindowEnd = Math.max(charEnd, ...contexts.map((context) => context.at(-1)?.end ?? charEnd));
    const values = [forms.original, forms.hans].map((positions) => positions
      .slice(lowerBound(positions, searchWindowStart, "end", true), lowerBound(positions, searchWindowEnd, "start", false))
      .map((position) => position.text).join(""));
    return { blockNo: blockNo++, charStart, charEnd, originalText: text.slice(charStart, charEnd), searchWindowStart, searchWindowEnd,
      searchTextOriginal: values[0], searchTextHans: values[0] === values[1] ? null : values[1] };
  }
  for (const character of text) {
    end += character.length;
    count += 1;
    if (count === blockCodePoints) { yield block(start, end); start = end; count = 0; }
  }
  if (end > start) yield block(start, end);
}
