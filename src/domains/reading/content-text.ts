/** Bump whenever Unicode processing, OpenCC dictionaries or the block layout change, so
 *  that stored offsets a reader or a search hit points at are rebuilt before they can be
 *  read against different text. v3: 1200-code-point blocks over NFKC-folded text. The
 *  search representation is versioned separately: it lives in novel_search_documents,
 *  which is rebuilt from these blocks without re-reading the library. */
export const CONTENT_NORMALIZATION_VERSION = 3;
export const CONTENT_BLOCK_CODE_POINTS = 1_200;

export type SearchTextMode = "title" | "content" | "phrase";
export type TextPosition = { text: string; start: number; end: number };
export type ChineseSearchForms = { original: string; hans: string | null; version: number };
export type ChineseSearchRange = { start: number; end: number };
export type ContentBlock = {
  blockNo: number;
  charStart: number;
  charEnd: number;
  /** Displayed verbatim: punctuation, spacing and case as the author wrote them. */
  originalText: string;
  /** This block's own normalized text, in the one indexed form. Concatenating every
   *  block of a document reproduces that document's search text exactly. */
  searchText: string;
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

export async function normalizeChineseSearchNeedles(
  values: readonly string[],
  mode: SearchTextMode = "content",
): Promise<string[]> {
  const needles = new Set<string>();
  for (const value of values) {
    const forms = await normalizeChineseSearchForms(value, mode);
    if (forms.original) needles.add(forms.original);
    if (forms.hans) needles.add(forms.hans);
  }
  return [...needles];
}

/** Finds normalized matches while retaining offsets in the original UTF-16 text.
 * This is shared by snippets and in-reader find, so punctuation, NFKC and
 * Traditional-to-Hans conversion cannot make a database hit impossible to show. */
export async function findNormalizedChineseSearchRanges(
  text: string,
  needles: readonly string[],
  mode: SearchTextMode = "content",
): Promise<ChineseSearchRange[]> {
  if (!needles.length || !text) return [];
  const forms = await normalizeChineseSearchPositions(text, mode);
  const ranges = new Map<string, ChineseSearchRange>();
  for (const positions of [forms.original, forms.hans]) {
    const normalized = positions.map((position) => position.text).join("");
    if (!normalized) continue;
    const spans: Array<{ normalizedStart: number; normalizedEnd: number; sourceStart: number; sourceEnd: number }> = [];
    let normalizedOffset = 0;
    for (const position of positions) {
      const normalizedEnd = normalizedOffset + position.text.length;
      spans.push({ normalizedStart: normalizedOffset, normalizedEnd, sourceStart: position.start, sourceEnd: position.end });
      normalizedOffset = normalizedEnd;
    }
    for (const needle of needles) {
      if (!needle) continue;
      for (let cursor = normalized.indexOf(needle); cursor >= 0;
        cursor = normalized.indexOf(needle, cursor + Math.max(needle.length, 1))) {
        const matchEnd = cursor + needle.length;
        const first = spans.find((span) => span.normalizedStart <= cursor && cursor < span.normalizedEnd);
        const last = spans.findLast((span) => span.normalizedStart < matchEnd && matchEnd <= span.normalizedEnd);
        if (!first || !last) continue;
        const range = { start: first.sourceStart, end: last.sourceEnd };
        ranges.set(`${range.start}:${range.end}`, range);
      }
    }
  }
  const candidates = [...ranges.values()].sort((left, right) => left.start - right.start || right.end - left.end);
  const selected: ChineseSearchRange[] = [];
  for (const candidate of candidates) {
    if (selected.every((range) => candidate.end <= range.start || candidate.start >= range.end)) selected.push(candidate);
  }
  return selected.sort((left, right) => left.start - right.start);
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

/**
 * Splits a document into fixed-size display blocks and, alongside each one, that
 * block's own normalized search text.
 *
 * Blocks used to carry a normalized context window reaching into their neighbours, so
 * that a keyword straddling a boundary could still be found in a single block row. The
 * search index is no longer built per block: a document is indexed as one contiguous
 * normalized string, in which no boundary exists to straddle. So each block now carries
 * exactly its own text, every normalized character belongs to exactly one block, and
 * concatenating them reproduces the document's search text.
 *
 * One normalized form is produced, not two. OpenCC conversion is idempotent for text
 * that is already Simplified, so indexing the converted form alone matches a query in
 * either script while halving the columns, indexes and query branches it takes.
 */
export async function* createContentBlocks(text: string, blockCodePoints = CONTENT_BLOCK_CODE_POINTS): AsyncGenerator<ContentBlock> {
  if (!Number.isSafeInteger(blockCodePoints) || blockCodePoints < 1 || blockCodePoints > 4_096) throw new Error("Invalid content block size");
  const positions = (await normalizeChineseSearchPositions(text)).hans;
  let start = 0;
  let end = 0;
  let count = 0;
  let blockNo = 0;
  // Every normalized character is assigned by where its source starts, using the same
  // test for both bounds. A conversion's output shares its whole source range, so one
  // straddling a boundary would satisfy an end-based lower bound and a start-based upper
  // bound at once and be copied into both blocks; starts never decrease, so this is an
  // exact partition.
  function block(charStart: number, charEnd: number): ContentBlock {
    const first = lowerBound(positions, charStart, "start", false);
    const last = lowerBound(positions, charEnd, "start", false);
    return {
      blockNo: blockNo++,
      charStart,
      charEnd,
      originalText: text.slice(charStart, charEnd),
      searchText: positions.slice(first, last).map((position) => position.text).join(""),
    };
  }
  for (const character of text) {
    end += character.length;
    count += 1;
    if (count === blockCodePoints) { yield block(start, end); start = end; count = 0; }
  }
  if (end > start) yield block(start, end);
}
