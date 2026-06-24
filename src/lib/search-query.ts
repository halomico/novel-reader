export type SearchExpression =
  | { type: "term"; value: string; normalized: string; required: boolean; phrase: boolean }
  | { type: "and"; left: SearchExpression; right: SearchExpression }
  | { type: "or"; left: SearchExpression; right: SearchExpression }
  | { type: "not"; child: SearchExpression };

export type SearchMatchMode = "content" | "title" | "index";

export type SearchTermPattern = {
  value: string;
  normalized: string;
  phrase: boolean;
  exact: boolean;
};

export type ParsedSearchQuery = {
  keyword: string;
  mode: SearchMatchMode;
  expression: SearchExpression;
  terms: string[];
  positiveTerms: string[];
  excludedTerms: string[];
  highlightTerms: SearchTermPattern[];
  requiredTerms: SearchTermPattern[];
  anchorTerm: string;
  isSingleKeyword: boolean;
};

export type SearchQueryValidation =
  | { ok: true; keyword: string; query: ParsedSearchQuery; terms: string[] }
  | { ok: false; keyword: string; message: string };

type SearchToken =
  | { type: "term"; value: string; normalized: string; required: boolean; phrase: boolean }
  | { type: "and" | "or" | "not" | "lparen" | "rparen" };

const MIN_CONTENT_SINGLE_KEYWORD_CHARS = 2;
const MIN_LOOSE_SINGLE_KEYWORD_CHARS = 1;
const MIN_MULTI_KEYWORD_CHARS = 1;
const MAX_CONTENT_KEYWORD_CHARS = 15;
const MAX_LOOSE_KEYWORD_CHARS = 30;
const MAX_PHRASE_CHARS = 50;
const MAX_MULTI_QUERY_CHARS = 200;
const SEARCH_SYNTAX_ERROR = "搜索语法有误，请检查 AND、OR、NOT、+、-、引号和括号的位置";

export function countSearchChars(value: string): number {
  return Array.from(value).length;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function normalizeSearchInput(value: string | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function isIgnoredSearchChar(char: string): boolean {
  return /[\s\p{P}\p{S}]/u.test(char);
}

function isIgnoredPhrasePunctuation(char: string): boolean {
  return /[\p{P}\p{S}]/u.test(char);
}

export function normalizeSearchText(value: string): string {
  return Array.from(value)
    .filter((char) => !isIgnoredSearchChar(char))
    .join("")
    .toLowerCase();
}

function normalizeContentPhraseText(value: string): string {
  return Array.from(value)
    .filter((char) => !isIgnoredPhrasePunctuation(char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function createSearchTextIndex(value: string): { normalized: string; positions: number[] } {
  let normalized = "";
  const positions: number[] = [];
  let index = 0;

  for (const char of value) {
    if (!isIgnoredSearchChar(char)) {
      normalized += char.toLowerCase();
      positions.push(index);
    }
    index += char.length;
  }

  return { normalized, positions };
}

function createContentPhraseIndex(value: string): { normalized: string; positions: number[] } {
  let normalized = "";
  const positions: number[] = [];
  let index = 0;
  let previousWasSpace = false;

  for (const char of value) {
    if (isIgnoredPhrasePunctuation(char)) {
      index += char.length;
      continue;
    }

    if (/\s/u.test(char)) {
      if (!previousWasSpace && normalized) {
        normalized += " ";
        positions.push(index);
      }
      previousWasSpace = true;
      index += char.length;
      continue;
    }

    normalized += char.toLowerCase();
    positions.push(index);
    previousWasSpace = false;
    index += char.length;
  }

  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    positions.pop();
  }

  return { normalized, positions };
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function isQuoteStart(char: string): boolean {
  return char === "\"" || char === "“" || char === "‘";
}

function isQuoteEnd(char: string): boolean {
  return char === "\"" || char === "”" || char === "’";
}

function tokenizeSearchQuery(keyword: string): { ok: true; tokens: SearchToken[]; hasOperator: boolean } | { ok: false; message: string } {
  const tokens: SearchToken[] = [];
  let index = 0;
  let nextTermRequired = false;
  let hasOperator = false;

  while (index < keyword.length) {
    const char = keyword[index];

    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (char === "(" || char === "（") {
      if (nextTermRequired) {
        return { ok: false, message: SEARCH_SYNTAX_ERROR };
      }
      tokens.push({ type: "lparen" });
      hasOperator = true;
      index += 1;
      continue;
    }

    if (char === ")" || char === "）") {
      tokens.push({ type: "rparen" });
      hasOperator = true;
      index += 1;
      continue;
    }

    if (char === "-") {
      tokens.push({ type: "not" });
      hasOperator = true;
      index += 1;
      continue;
    }

    if (char === "+") {
      if (nextTermRequired) {
        return { ok: false, message: SEARCH_SYNTAX_ERROR };
      }
      nextTermRequired = true;
      hasOperator = true;
      index += 1;
      continue;
    }

    if (isQuoteStart(char)) {
      const start = index + 1;
      index = start;
      while (index < keyword.length && !isQuoteEnd(keyword[index])) {
        index += 1;
      }

      if (index >= keyword.length) {
        return { ok: false, message: "搜索短语缺少结束引号" };
      }

      const value = keyword.slice(start, index);
      if (!value) {
        return { ok: false, message: "引号内必须包含可搜索内容" };
      }

      tokens.push({ type: "term", value, normalized: normalizeSearchText(value), required: nextTermRequired, phrase: true });
      nextTermRequired = false;
      hasOperator = true;
      index += 1;
      continue;
    }

    const start = index;
    while (
      index < keyword.length &&
      !/\s/u.test(keyword[index]) &&
      keyword[index] !== "(" &&
      keyword[index] !== ")" &&
      keyword[index] !== "（" &&
      keyword[index] !== "）" &&
      !isQuoteStart(keyword[index])
    ) {
      index += 1;
    }

    const rawValue = keyword.slice(start, index);
    const operator = rawValue.toUpperCase();
    if (!nextTermRequired && (operator === "AND" || operator === "OR" || operator === "NOT")) {
      tokens.push({ type: operator.toLowerCase() as "and" | "or" | "not" });
      hasOperator = true;
    } else {
      tokens.push({ type: "term", value: rawValue, normalized: normalizeSearchText(rawValue), required: nextTermRequired, phrase: false });
    }
    nextTermRequired = false;
  }

  if (nextTermRequired) {
    return { ok: false, message: SEARCH_SYNTAX_ERROR };
  }

  return { ok: true, tokens, hasOperator };
}

function parseSearchTokens(tokens: SearchToken[]): SearchExpression | null {
  let index = 0;

  function peek(): SearchToken | undefined {
    return tokens[index];
  }

  function consume(): SearchToken {
    const token = tokens[index];
    index += 1;
    return token;
  }

  function canStartExpression(token: SearchToken | undefined): boolean {
    return token?.type === "term" || token?.type === "not" || token?.type === "lparen";
  }

  function parsePrimary(): SearchExpression | null {
    const token = peek();
    if (!token) {
      return null;
    }

    if (token.type === "term") {
      consume();
      return { type: "term", value: token.value, normalized: token.normalized, required: token.required, phrase: token.phrase };
    }

    if (token.type === "lparen") {
      consume();
      const node = parseOr();
      if (!node || peek()?.type !== "rparen") {
        return null;
      }
      consume();
      return node;
    }

    return null;
  }

  function parseUnary(): SearchExpression | null {
    if (peek()?.type === "not") {
      consume();
      const child = parseUnary();
      return child ? { type: "not", child } : null;
    }

    return parsePrimary();
  }

  function parseAnd(): SearchExpression | null {
    let node = parseUnary();
    if (!node) {
      return null;
    }

    while (true) {
      const token = peek();
      if (!token || token.type === "or" || token.type === "rparen") {
        break;
      }

      if (token.type === "and") {
        consume();
      } else if (!canStartExpression(token)) {
        return null;
      }

      const right = parseUnary();
      if (!right) {
        return null;
      }
      node = { type: "and", left: node, right };
    }

    return node;
  }

  function parseOr(): SearchExpression | null {
    let node = parseAnd();
    if (!node) {
      return null;
    }

    while (peek()?.type === "or") {
      consume();
      const right = parseAnd();
      if (!right) {
        return null;
      }
      node = { type: "or", left: node, right };
    }

    return node;
  }

  const expression = parseOr();
  return expression && index === tokens.length ? expression : null;
}

type SearchTermInfo = {
  value: string;
  normalized: string;
  phrase: boolean;
};

function collectTerms(expression: SearchExpression, negated = false): { all: string[]; positive: string[]; excluded: string[]; positivePhrases: string[] } {
  if (expression.type === "term") {
    return {
      all: [expression.value],
      positive: negated ? [] : [expression.value],
      excluded: negated ? [expression.value] : [],
      positivePhrases: !negated && expression.phrase ? [expression.value] : [],
    };
  }

  if (expression.type === "not") {
    return collectTerms(expression.child, !negated);
  }

  const left = collectTerms(expression.left, negated);
  const right = collectTerms(expression.right, negated);
  return {
    all: [...left.all, ...right.all],
    positive: [...left.positive, ...right.positive],
    excluded: [...left.excluded, ...right.excluded],
    positivePhrases: [...left.positivePhrases, ...right.positivePhrases],
  };
}

function sameTermInfo(left: SearchTermInfo, right: SearchTermInfo): boolean {
  return left.value === right.value && left.normalized === right.normalized && left.phrase === right.phrase;
}

function uniqueTermInfos(values: SearchTermInfo[]): SearchTermInfo[] {
  const result: SearchTermInfo[] = [];
  for (const value of values) {
    if (!result.some((item) => sameTermInfo(item, value))) {
      result.push(value);
    }
  }
  return result;
}

function collectTermInfos(expression: SearchExpression): SearchTermInfo[] {
  if (expression.type === "term") {
    return [{ value: expression.value, normalized: expression.normalized, phrase: expression.phrase }];
  }

  if (expression.type === "not") {
    return collectTermInfos(expression.child);
  }

  return uniqueTermInfos([...collectTermInfos(expression.left), ...collectTermInfos(expression.right)]);
}

function collectPlusRequiredTerms(expression: SearchExpression, negated = false): SearchTermInfo[] {
  if (expression.type === "term") {
    return expression.required && !negated
      ? [{ value: expression.value, normalized: expression.normalized, phrase: expression.phrase }]
      : [];
  }

  if (expression.type === "not") {
    return collectPlusRequiredTerms(expression.child, !negated);
  }

  return [...collectPlusRequiredTerms(expression.left, negated), ...collectPlusRequiredTerms(expression.right, negated)];
}

function unionTerms(left: SearchTermInfo[], right: SearchTermInfo[]): SearchTermInfo[] {
  return uniqueTermInfos([...left, ...right]);
}

function intersectTerms(left: SearchTermInfo[], right: SearchTermInfo[]): SearchTermInfo[] {
  return left.filter((term) => right.some((item) => sameTermInfo(item, term)));
}

function collectGuaranteedTerms(expression: SearchExpression, negated = false): SearchTermInfo[] {
  if (expression.type === "not") {
    return collectGuaranteedTerms(expression.child, !negated);
  }

  if (negated) {
    return [];
  }

  if (expression.type === "term") {
    return [{ value: expression.value, normalized: expression.normalized, phrase: expression.phrase }];
  }

  if (expression.type === "and") {
    return unionTerms(collectGuaranteedTerms(expression.left), collectGuaranteedTerms(expression.right));
  }

  return intersectTerms(collectGuaranteedTerms(expression.left), collectGuaranteedTerms(expression.right));
}

function findAnchorTerm(requiredTerms: SearchTermInfo[]): string {
  return requiredTerms
    .filter((term) => !term.phrase && countSearchChars(term.normalized) >= MIN_CONTENT_SINGLE_KEYWORD_CHARS)
    .sort((left, right) => countSearchChars(right.normalized) - countSearchChars(left.normalized))[0]?.normalized || "";
}

function getSingleKeywordMinChars(mode: SearchMatchMode): number {
  return mode === "content" ? MIN_CONTENT_SINGLE_KEYWORD_CHARS : MIN_LOOSE_SINGLE_KEYWORD_CHARS;
}

function getKeywordMaxChars(mode: SearchMatchMode): number {
  return mode === "content" ? MAX_CONTENT_KEYWORD_CHARS : MAX_LOOSE_KEYWORD_CHARS;
}

function singleKeywordLengthMessage(mode: SearchMatchMode): string {
  if (mode === "content") {
    return "单关键词需为 2 到 15 字";
  }
  return mode === "index" ? "索引关键词需为 1 到 30 字" : "书名关键词需为 1 到 30 字";
}

function multiKeywordLengthMessage(mode: SearchMatchMode): string {
  return mode === "content" ? "普通关键词需为 1 到 15 字，引号短语需为 1 到 50 字" : "普通关键词需为 1 到 30 字，引号短语需为 1 到 50 字";
}

function getTermLength(term: SearchTermInfo, mode: SearchMatchMode): number {
  if (mode === "content" && term.phrase) {
    return countSearchChars(normalizeContentPhraseText(term.value));
  }
  return countSearchChars(mode === "title" ? term.value : term.normalized);
}

function termHasSearchableContent(term: SearchTermInfo, mode: SearchMatchMode): boolean {
  if (mode === "title") {
    return term.value.length > 0;
  }
  if (term.phrase) {
    return normalizeContentPhraseText(term.value).replace(/\s/g, "").length > 0;
  }
  return term.normalized.length > 0;
}

function toSearchPattern(term: SearchTermInfo, mode: SearchMatchMode): SearchTermPattern {
  const isContentPhrase = mode === "content" && term.phrase;
  return {
    value: term.value,
    normalized: isContentPhrase ? normalizeContentPhraseText(term.value) : term.normalized,
    phrase: isContentPhrase,
    exact: mode === "title" || isContentPhrase,
  };
}

export function parseSearchQuery(value: string | undefined, options: { mode?: SearchMatchMode } = {}): SearchQueryValidation {
  const mode = options.mode || "content";
  const keyword = normalizeSearchInput(value);
  if (!keyword) {
    return { ok: false, keyword, message: "请输入搜索关键词" };
  }

  const tokenized = tokenizeSearchQuery(keyword);
  if (!tokenized.ok) {
    return { ok: false, keyword, message: tokenized.message };
  }

  const expression = parseSearchTokens(tokenized.tokens);
  if (!expression) {
    return { ok: false, keyword, message: SEARCH_SYNTAX_ERROR };
  }

  const collected = collectTerms(expression);
  const termInfos = collectTermInfos(expression);
  const terms = uniqueValues(collected.all);
  const positiveTerms = uniqueValues(collected.positive);
  const excludedTerms = uniqueValues(collected.excluded);
  const isSingleKeyword = terms.length === 1 && positiveTerms.length === 1 && excludedTerms.length === 0;
  const totalTermLength = termInfos.reduce((total, term) => total + getTermLength(term, mode), 0);

  if (!positiveTerms.length) {
    return { ok: false, keyword, message: "至少需要一个正向关键词" };
  }

  if (termInfos.some((term) => !termHasSearchableContent(term, mode))) {
    return {
      ok: false,
      keyword,
      message: mode === "title" ? "关键词不能为空" : mode === "index" ? "索引关键词不能只包含标点或符号" : "正文关键词不能只包含标点或符号",
    };
  }

  if (isSingleKeyword) {
    if (tokenized.hasOperator) {
      return { ok: false, keyword, message: "搜索运算符只支持多关键词搜索" };
    }
    const length = getTermLength(termInfos[0], mode);
    if (length < getSingleKeywordMinChars(mode) || length > getKeywordMaxChars(mode)) {
      return { ok: false, keyword, message: singleKeywordLengthMessage(mode) };
    }
  } else if (totalTermLength > MAX_MULTI_QUERY_CHARS) {
    return { ok: false, keyword, message: "多关键词总长度不能超过 200 字" };
  } else if (
    termInfos.some((term) => {
      const length = getTermLength(term, mode);
      return length < MIN_MULTI_KEYWORD_CHARS || length > (term.phrase ? MAX_PHRASE_CHARS : getKeywordMaxChars(mode));
    })
  ) {
    return { ok: false, keyword, message: multiKeywordLengthMessage(mode) };
  }

  const requiredTermInfos = uniqueTermInfos([...collectPlusRequiredTerms(expression), ...collectGuaranteedTerms(expression)]);
  const requiredTerms = requiredTermInfos.map((term) => toSearchPattern(term, mode));
  const anchorTerm = findAnchorTerm(requiredTermInfos);
  const requiredPhraseTerms = new Set(requiredTermInfos.filter((term) => term.phrase).map((term) => term.value));
  const hasLoosePositivePhrase = uniqueValues(collected.positivePhrases).some((term) => !requiredPhraseTerms.has(term));
  if (mode === "content" && hasLoosePositivePhrase) {
    return { ok: false, keyword, message: "引号短语必须和 AND 必含关键词一起使用，不能放在 OR 分支中" };
  }

  if (mode === "content" && !anchorTerm) {
    return { ok: false, keyword, message: "多关键词必须包含一个 2 字以上的 AND 必含关键词" };
  }

  const query: ParsedSearchQuery = {
    keyword,
    mode,
    expression,
    terms,
    positiveTerms,
    excludedTerms,
    highlightTerms: termInfos.filter((term) => positiveTerms.includes(term.value)).map((term) => toSearchPattern(term, mode)),
    requiredTerms,
    anchorTerm,
    isSingleKeyword,
  };

  return { ok: true, keyword, query, terms };
}

function findExactIndex(text: string, value: string, fromIndex = 0): number {
  return text.toLowerCase().indexOf(value.toLowerCase(), fromIndex);
}

function findContentPhraseIndex(text: string, term: SearchTermPattern): number {
  return createContentPhraseIndex(text).normalized.indexOf(term.normalized.toLowerCase());
}

function findTermIndex(text: string, term: SearchTermPattern): number {
  if (term.exact) {
    return term.phrase ? findContentPhraseIndex(text, term) : findExactIndex(text, term.value);
  }

  return normalizeSearchText(text).indexOf(term.normalized.toLowerCase());
}

function expressionTermToPattern(expression: Extract<SearchExpression, { type: "term" }>, mode: SearchMatchMode): SearchTermPattern {
  return toSearchPattern({ value: expression.value, normalized: expression.normalized, phrase: expression.phrase }, mode);
}

function findLooseRanges(text: string, term: SearchTermPattern): Array<{ start: number; end: number; term: string }> {
  const searchIndex = createSearchTextIndex(text);
  const ranges: Array<{ start: number; end: number; term: string }> = [];
  const value = term.normalized;
  if (!value) {
    return ranges;
  }

  let cursor = searchIndex.normalized.indexOf(value);
  while (cursor >= 0) {
    const termLength = countSearchChars(value);
    const start = searchIndex.positions[cursor];
    const lastCharStart = searchIndex.positions[cursor + termLength - 1];
    if (start !== undefined && lastCharStart !== undefined) {
      const end = lastCharStart + Array.from(text.slice(lastCharStart))[0].length;
      ranges.push({ start, end, term: term.value });
    }
    cursor = searchIndex.normalized.indexOf(value, cursor + termLength);
  }

  return ranges;
}

function findExactRanges(text: string, term: SearchTermPattern): Array<{ start: number; end: number; term: string }> {
  const ranges: Array<{ start: number; end: number; term: string }> = [];
  if (!term.value) {
    return ranges;
  }

  let cursor = 0;
  let index = findExactIndex(text, term.value, cursor);
  while (index >= 0) {
    ranges.push({ start: index, end: index + term.value.length, term: term.value });
    cursor = index + Math.max(term.value.length, 1);
    index = findExactIndex(text, term.value, cursor);
  }

  return ranges;
}

function findContentPhraseRanges(text: string, term: SearchTermPattern): Array<{ start: number; end: number; term: string }> {
  const searchIndex = createContentPhraseIndex(text);
  const ranges: Array<{ start: number; end: number; term: string }> = [];
  if (!term.normalized) {
    return ranges;
  }

  let cursor = searchIndex.normalized.indexOf(term.normalized.toLowerCase());
  while (cursor >= 0) {
    const termLength = countSearchChars(term.normalized);
    const start = searchIndex.positions[cursor];
    const lastCharStart = searchIndex.positions[cursor + termLength - 1];
    if (start !== undefined && lastCharStart !== undefined) {
      const end = lastCharStart + Array.from(text.slice(lastCharStart))[0].length;
      ranges.push({ start, end, term: term.value });
    }
    cursor = searchIndex.normalized.indexOf(term.normalized.toLowerCase(), cursor + termLength);
  }

  return ranges;
}

export function findSearchTermRanges(text: string, terms: SearchTermPattern[]): Array<{ start: number; end: number; term: string }> {
  const ranges = terms.flatMap((term) => (term.phrase ? findContentPhraseRanges(text, term) : term.exact ? findExactRanges(text, term) : findLooseRanges(text, term)));
  const sorted = ranges.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
  const selected: Array<{ start: number; end: number; term: string }> = [];

  for (const range of sorted) {
    if (selected.every((item) => range.end <= item.start || range.start >= item.end)) {
      selected.push(range);
    }
  }

  return selected.sort((left, right) => left.start - right.start);
}

export function findFirstSearchTerm(text: string, terms: SearchTermPattern[]): { index: number; end: number; term: string } | null {
  const ranges = findSearchTermRanges(text, terms);
  return ranges[0] ? { index: ranges[0].start, end: ranges[0].end, term: ranges[0].term } : null;
}

function evaluateSearchExpression(expression: SearchExpression, text: string, mode: SearchMatchMode): boolean {
  if (expression.type === "term") {
    return findTermIndex(text, expressionTermToPattern(expression, mode)) >= 0;
  }

  if (expression.type === "not") {
    return !evaluateSearchExpression(expression.child, text, mode);
  }

  if (expression.type === "and") {
    return evaluateSearchExpression(expression.left, text, mode) && evaluateSearchExpression(expression.right, text, mode);
  }

  return evaluateSearchExpression(expression.left, text, mode) || evaluateSearchExpression(expression.right, text, mode);
}

export function matchesParsedSearchQuery(text: string, query: ParsedSearchQuery): boolean {
  return query.requiredTerms.every((term) => findTermIndex(text, term) >= 0) && evaluateSearchExpression(query.expression, text, query.mode);
}

export function createSearchSnippet(content: string, terms: SearchTermPattern[], before = 56, after = 84): string {
  const match = findFirstSearchTerm(content, terms);
  if (!match) {
    return content.trim().slice(0, before + after);
  }

  const start = Math.max(0, match.index - before);
  const end = Math.min(content.length, match.end + after);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}
