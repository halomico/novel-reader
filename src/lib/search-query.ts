export type SearchMatchMode = "content" | "title" | "index";

export type SearchTermPattern = Readonly<{
  value: string;
  normalized: string;
  phrase: false;
  exact: boolean;
}>;

export type ParsedSearchQuery = Readonly<{
  syntax: "simple-and";
  keyword: string;
  mode: SearchMatchMode;
  terms: readonly string[];
  highlightTerms: readonly SearchTermPattern[];
  requiredTerms: readonly SearchTermPattern[];
  anchorTerm: string;
  isSingleKeyword: boolean;
}>;

export type SearchQueryValidation =
  | { ok: true; keyword: string; query: ParsedSearchQuery; terms: readonly string[] }
  | { ok: false; keyword: string; message: string };

const MIN_CONTENT_SINGLE_KEYWORD_CHARS = 2;
/** Longest public full-text keyword. Index blocks carry exactly enough neighbouring
 *  context for a keyword of this length to match across a block boundary. */
export const MAX_CONTENT_KEYWORD_CHARS = 15;
const MAX_LOOSE_KEYWORD_CHARS = 30;
const MAX_MULTI_QUERY_CHARS = 200;
const MAX_SIMPLE_AND_TERMS = 12;

export function countSearchChars(value: string): number {
  return Array.from(value).length;
}

export function normalizeSearchText(value: string): string {
  return value.replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase("und");
}

function normalizeSearchInput(value: string | undefined): string {
  return (value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function uniqueTerms(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase("und");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function maximumTermLength(mode: SearchMatchMode): number {
  return mode === "content" ? MAX_CONTENT_KEYWORD_CHARS : MAX_LOOSE_KEYWORD_CHARS;
}

function searchableTerm(term: string, mode: SearchMatchMode): string {
  return mode === "title" ? term.toLocaleLowerCase("und") : normalizeSearchText(term);
}

function singleLengthMessage(mode: SearchMatchMode): string {
  if (mode === "content") return "单关键词需为 2 到 15 字";
  return mode === "index" ? "索引关键词需为 1 到 30 字" : "书名关键词需为 1 到 30 字";
}

function multiLengthMessage(mode: SearchMatchMode): string {
  return mode === "content" ? "每个正文关键词需为 1 到 15 字" : "每个关键词需为 1 到 30 字";
}

/**
 * The only supported public grammar is a bounded list of whitespace-separated
 * literal terms. Every term is required. Words such as AND, OR and NOT have no
 * special meaning and are searched as ordinary text.
 */
export function parseSimpleAndSearchQuery(
  value: string | undefined,
  options: { mode?: SearchMatchMode } = {},
): SearchQueryValidation {
  const mode = options.mode ?? "content";
  const keyword = normalizeSearchInput(value);
  if (!keyword) return { ok: false, keyword, message: "请输入搜索关键词" };

  const terms = uniqueTerms(keyword.split(" "));
  if (terms.length > MAX_SIMPLE_AND_TERMS) {
    return { ok: false, keyword, message: `关键词不能超过 ${MAX_SIMPLE_AND_TERMS} 个` };
  }
  const normalized = terms.map((term) => searchableTerm(term, mode));
  if (normalized.some((term) => !term)) {
    return {
      ok: false,
      keyword,
      message: mode === "title" ? "关键词不能为空" : "正文关键词不能只包含标点或符号",
    };
  }
  const lengths = normalized.map(countSearchChars);
  const maximum = maximumTermLength(mode);
  if (terms.length === 1 && (lengths[0] < (mode === "content" ? MIN_CONTENT_SINGLE_KEYWORD_CHARS : 1)
      || lengths[0] > maximum)) {
    return { ok: false, keyword, message: singleLengthMessage(mode) };
  }
  if (lengths.some((length) => length < 1 || length > maximum)) {
    return { ok: false, keyword, message: multiLengthMessage(mode) };
  }
  if (lengths.reduce((total, length) => total + length, 0) > MAX_MULTI_QUERY_CHARS) {
    return { ok: false, keyword, message: "多关键词总长度不能超过 200 字" };
  }
  const anchorTerm = normalized
    .filter((term) => countSearchChars(term) >= MIN_CONTENT_SINGLE_KEYWORD_CHARS)
    .sort((left, right) => countSearchChars(right) - countSearchChars(left))[0] ?? "";
  if (mode === "content" && !anchorTerm) {
    return { ok: false, keyword, message: "关键词中至少需要一个 2 字以上的词" };
  }
  const requiredTerms = terms.map<SearchTermPattern>((term, index) => ({
    value: term,
    normalized: normalized[index],
    phrase: false,
    exact: mode === "title",
  }));
  const query: ParsedSearchQuery = {
    syntax: "simple-and",
    keyword,
    mode,
    terms,
    highlightTerms: requiredTerms,
    requiredTerms,
    anchorTerm,
    isSingleKeyword: terms.length === 1,
  };
  return { ok: true, keyword, query, terms };
}

/** Compatibility name for internal callers; it has the same literal-AND grammar. */
export function parseSearchQuery(
  value: string | undefined,
  options: { mode?: SearchMatchMode } = {},
): SearchQueryValidation {
  return parseSimpleAndSearchQuery(value, options);
}

export function validateSearchKeyword(value: string | undefined): SearchQueryValidation {
  return parseSimpleAndSearchQuery(value);
}

function createSearchTextIndex(value: string): { normalized: string; positions: number[] } {
  let normalized = "";
  const positions: number[] = [];
  let offset = 0;
  for (const character of value) {
    if (!/[\s\p{P}\p{S}]/u.test(character)) {
      normalized += character.toLocaleLowerCase("und");
      positions.push(offset);
    }
    offset += character.length;
  }
  return { normalized, positions };
}

function findTermIndex(text: string, term: SearchTermPattern, normalizedText?: string): number {
  if (term.exact) return text.toLocaleLowerCase("und").indexOf(term.value.toLocaleLowerCase("und"));
  return (normalizedText ?? normalizeSearchText(text)).indexOf(term.normalized);
}

function looseRanges(text: string, term: SearchTermPattern): Array<{ start: number; end: number; term: string }> {
  const index = createSearchTextIndex(text);
  const ranges: Array<{ start: number; end: number; term: string }> = [];
  const length = countSearchChars(term.normalized);
  for (let cursor = index.normalized.indexOf(term.normalized); cursor >= 0;
    cursor = index.normalized.indexOf(term.normalized, cursor + Math.max(length, 1))) {
    const start = index.positions[cursor];
    const lastCharacterStart = index.positions[cursor + length - 1];
    if (start !== undefined && lastCharacterStart !== undefined) {
      const lastCharacter = Array.from(text.slice(lastCharacterStart))[0];
      ranges.push({ start, end: lastCharacterStart + lastCharacter.length, term: term.value });
    }
  }
  return ranges;
}

function exactRanges(text: string, term: SearchTermPattern): Array<{ start: number; end: number; term: string }> {
  const ranges: Array<{ start: number; end: number; term: string }> = [];
  const haystack = text.toLocaleLowerCase("und");
  const needle = term.value.toLocaleLowerCase("und");
  for (let cursor = haystack.indexOf(needle); cursor >= 0;
    cursor = haystack.indexOf(needle, cursor + Math.max(needle.length, 1))) {
    ranges.push({ start: cursor, end: cursor + term.value.length, term: term.value });
  }
  return ranges;
}

export function findSearchTermRanges(
  text: string,
  terms: readonly SearchTermPattern[],
): Array<{ start: number; end: number; term: string }> {
  const candidates = terms.flatMap((term) => term.exact ? exactRanges(text, term) : looseRanges(text, term))
    .sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const selected: Array<{ start: number; end: number; term: string }> = [];
  for (const candidate of candidates) {
    if (selected.every((range) => candidate.end <= range.start || candidate.start >= range.end)) selected.push(candidate);
  }
  return selected.sort((left, right) => left.start - right.start);
}

export function findFirstSearchTerm(
  text: string,
  terms: readonly SearchTermPattern[],
): { index: number; end: number; term: string } | null {
  const first = findSearchTermRanges(text, terms)[0];
  return first ? { index: first.start, end: first.end, term: first.term } : null;
}

export function matchesParsedSearchQuery(text: string, query: ParsedSearchQuery, normalizedText?: string): boolean {
  const prepared = normalizedText ?? (query.mode === "content" ? normalizeSearchText(text) : undefined);
  return query.requiredTerms.every((term) => findTermIndex(text, term, prepared) >= 0);
}

export function createSearchSnippet(
  content: string,
  terms: readonly SearchTermPattern[],
  before = 56,
  after = 84,
): string {
  const match = findFirstSearchTerm(content, terms);
  if (!match) return content.trim().slice(0, before + after);
  const start = Math.max(0, match.index - before);
  const end = Math.min(content.length, match.end + after);
  return `${start > 0 ? "..." : ""}${content.slice(start, end).trim()}${end < content.length ? "..." : ""}`;
}
