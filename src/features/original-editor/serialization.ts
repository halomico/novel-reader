export const PAID_GATE_TOKEN = "NOVEL_READER_PAID_GATE_NODE_V1";

export type OriginalOutlineItem = {
  id: string;
  level: number;
  text: string;
  paid: boolean;
};

export type SerializedOriginalDocument = {
  publicMarkdown: string;
  paidMarkdown: string;
  outline: OriginalOutlineItem[];
  publicAssetIds: number[];
  paidAssetIds: number[];
  publicWordCount: number;
  paidWordCount: number;
  paidGateCount: number;
};

type SerializedNode = {
  type?: string;
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  url?: string;
  anchorId?: string;
  assetId?: number;
  altText?: string;
  caption?: string;
  width?: number;
  height?: number;
  language?: string;
  value?: number;
  checked?: boolean;
  headerState?: number;
  children?: SerializedNode[];
};

type SerializedEditorState = { root?: SerializedNode };

const MAX_EDITOR_JSON_BYTES = 4 * 1024 * 1024;
const MAX_BODY_CHARACTERS = 500_000;

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function safeUrl(value: unknown): string {
  const url = String(value || "").trim();
  if (!url || /[\r\n\0]/u.test(url)) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function textFormat(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}

function serializeInline(node: SerializedNode): string {
  if (node.type === "linebreak") return "  \n";
  if (node.type === "link" || node.type === "autolink") {
    const content = (node.children || []).map(serializeInline).join("") || safeUrl(node.url);
    const url = safeUrl(node.url);
    return url ? `[${content || url}](${url})` : content;
  }
  if (node.type !== "text") return (node.children || []).map(serializeInline).join("");
  let text = escapeMarkdown(normalizeText(node.text));
  const format = textFormat(node.format);
  if (format & 16) text = `\`${text.replace(/`/g, "\\`")}\``;
  if (format & 4) text = `~~${text}~~`;
  // Underline has no CommonMark syntax; `<u>` is the one representation that renders
  // and round-trips everywhere. See ORIGINAL_MARKDOWN_TRANSFORMERS.
  if (format & 8) text = `<u>${text}</u>`;
  if (format & 2) text = `*${text}*`;
  if (format & 1) text = `**${text}**`;
  return text;
}

function plainText(node: SerializedNode): string {
  if (node.type === "text") return normalizeText(node.text);
  if (node.type === "linebreak") return "\n";
  return (node.children || []).map(plainText).join("");
}

function stableHeadingId(value: unknown, index: number, used: Set<string>): string {
  const candidate = String(value || "").trim();
  const base = /^heading_[A-Za-z0-9_-]{8,80}$/u.test(candidate)
    ? candidate
    : `heading_legacy_${String(index + 1).padStart(4, "0")}`;
  // Copying a heading clones its anchor, so uniqueness is enforced at the one place
  // that writes the stored document rather than trusted from the editor state.
  let id = base;
  for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
  used.add(id);
  return id;
}

/**
 * Serialize a node's children, whichever kind they are. Lexical puts inline content
 * directly inside quotes and list items rather than wrapping it in a paragraph, so a
 * container has to handle both instead of assuming one.
 */
function serializeChildren(
  children: SerializedNode[],
  state: Parameters<typeof serializeBlock>[1],
  depth: number,
): string {
  const blocks: string[] = [];
  let inline: SerializedNode[] = [];
  const flush = () => {
    if (!inline.length) return;
    const text = inline.map(serializeInline).join("").trimEnd();
    if (text) blocks.push(text);
    inline = [];
  };
  for (const child of children) {
    if (child.type === "text" || child.type === "linebreak" || child.type === "link" || child.type === "autolink") {
      inline.push(child);
      continue;
    }
    flush();
    const block = serializeBlock(child, state, depth + 1);
    if (block) blocks.push(block);
  }
  flush();
  return blocks.join("\n\n");
}

function serializeBlock(
  node: SerializedNode,
  state: {
    paid: boolean;
    outline: OriginalOutlineItem[];
    publicAssets: Set<number>;
    paidAssets: Set<number>;
    headingIndex: number;
    headingIds: Set<string>;
  },
  depth = 0,
): string {
  const children = node.children || [];
  if (node.type === "paragraph") return children.map(serializeInline).join("").trimEnd();
  if (node.type === "heading" || node.type === "original-heading") {
    const text = plainText(node).trim();
    const level = /^h[1-6]$/u.test(String(node.tag)) ? Number(String(node.tag).slice(1)) : 1;
    const id = stableHeadingId(node.anchorId, state.headingIndex++, state.headingIds);
    if (text) state.outline.push({ id, level, text, paid: state.paid });
    return text ? `<!-- original-heading:${id} -->\n${"#".repeat(level)} ${escapeMarkdown(text)}` : "";
  }
  if (node.type === "quote") {
    // A quote holds inline children directly, not paragraphs. Routing them through
    // `serializeBlock` produced an empty `>` line and silently dropped the quotation.
    return serializeChildren(children, state, depth)
      .split("\n").map((line) => `> ${line}`).join("\n");
  }
  if (node.type === "code") {
    const language = String(node.language || "").replace(/[^A-Za-z0-9_+-]/g, "").slice(0, 30);
    const content = plainText(node).replace(/\n+$/g, "");
    const fence = content.includes("```") ? "````" : "```";
    return `${fence}${language}\n${content}\n${fence}`;
  }
  if (node.type === "horizontalrule" || node.type === "original-divider") return "---";
  if (node.type === "original-image") {
    const assetId = Number(node.assetId);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) return "";
    (state.paid ? state.paidAssets : state.publicAssets).add(assetId);
    const alt = normalizeText(node.altText).replace(/[\]\n]/g, " ").trim().slice(0, 300);
    const caption = normalizeText(node.caption).replace(/[\n]/g, " ").trim().slice(0, 500);
    const width = Math.max(1, Math.floor(Number(node.width) || 1));
    const height = Math.max(1, Math.floor(Number(node.height) || 1));
    const title = caption ? ` "${caption.replace(/"/g, "\\\"")}"` : "";
    return `![${alt}](/original/assets/${assetId}${title})\n<!-- original-image-size:${width}x${height} -->`;
  }
  if (node.type === "list") {
    const ordered = node.listType === "number";
    const check = node.listType === "check";
    let number = 0;
    return children.map((child) => {
      const content = serializeBlock(child, state, depth + 1).replace(/\n/gu, "\n  ");
      // A list item that only wraps a nested list is structure, not an entry, so it
      // must not consume a number of its own.
      const wrapper = (child.children || []).every((grandChild) => grandChild.type === "list");
      if (wrapper) return content ? `  ${content}` : "";
      if (ordered) number = Number.isSafeInteger(Number(child.value)) && Number(child.value) > 0 ? Number(child.value) : number + 1;
      const marker = ordered ? `${number}.` : check ? `- [${child.checked ? "x" : " "}]` : "-";
      return `${marker} ${content}`;
    }).filter(Boolean).join("\n");
  }
  if (node.type === "listitem") {
    // Inline children are the item's text; a nested list is a block below it.
    const inline = children.filter((child) => child.type !== "list");
    const nested = children.filter((child) => child.type === "list");
    const parts = [serializeChildren(inline, state, depth)];
    for (const list of nested) parts.push(serializeBlock(list, state, depth + 1));
    return parts.filter(Boolean).join("\n");
  }
  if (node.type === "table") {
    const rows = children.filter((child) => child.type === "tablerow");
    if (!rows.length) return "";
    const cells = (row: SerializedNode) => (row.children || [])
      .filter((cell) => cell.type === "tablecell")
      .map((cell) => (cell.children || [])
        .map((child) => serializeBlock(child, state, depth + 1))
        .filter(Boolean)
        .join("<br>")
        .replace(/\|/gu, "\\|"));
    const header = cells(rows[0]);
    if (!header.length) return "";
    const line = (values: string[]) => `| ${values.join(" | ")} |`;
    return [line(header), line(header.map(() => "---")), ...rows.slice(1).map((row) => line(cells(row)))].join("\n");
  }
  return children.map((child) => serializeBlock(child, state, depth + 1)).filter(Boolean).join("\n\n");
}

export function countOriginalMarkdownCharacters(markdown: string): number {
  const text = markdown
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/```[^]*?```/g, (block) => block.replace(/^```[^\n]*|```$/g, ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ""))
    .replace(/<\/?u>/gu, "")
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gmu, "")
    .replace(/[#>*_`~\-|]+/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return Array.from(text).length;
}

export function parseEditorStateJson(value: string): SerializedEditorState {
  if (new TextEncoder().encode(value).byteLength > MAX_EDITOR_JSON_BYTES) throw new Error("编辑器内容超过 4 MB 保存上限，请减少内容或拆分文章");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("编辑器内容格式无效");
  }
  if (!parsed || typeof parsed !== "object" || !(parsed as SerializedEditorState).root) {
    throw new Error("编辑器内容缺少根节点");
  }
  return parsed as SerializedEditorState;
}

export function serializeOriginalEditorState(value: string): SerializedOriginalDocument {
  const editorState = parseEditorStateJson(value);
  const root = editorState.root!;
  const state = {
    paid: false,
    outline: [] as OriginalOutlineItem[],
    publicAssets: new Set<number>(),
    paidAssets: new Set<number>(),
    headingIndex: 0,
    headingIds: new Set<string>(),
  };
  const publicBlocks: string[] = [];
  const paidBlocks: string[] = [];
  let paidGateCount = 0;
  for (const child of root.children || []) {
    if (child.type === "paid-gate") {
      paidGateCount += 1;
      state.paid = true;
      continue;
    }
    const block = serializeBlock(child, state).trim();
    if (!block) continue;
    (state.paid ? paidBlocks : publicBlocks).push(block);
  }
  const publicMarkdown = publicBlocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  const paidMarkdown = paidBlocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (publicMarkdown.length + paidMarkdown.length > MAX_BODY_CHARACTERS) {
    throw new Error(`正文超过限制 ${publicMarkdown.length + paidMarkdown.length - MAX_BODY_CHARACTERS} 字`);
  }
  return {
    publicMarkdown,
    paidMarkdown,
    outline: state.outline,
    publicAssetIds: [...state.publicAssets],
    paidAssetIds: [...state.paidAssets],
    publicWordCount: countOriginalMarkdownCharacters(publicMarkdown),
    paidWordCount: countOriginalMarkdownCharacters(paidMarkdown),
    paidGateCount,
  };
}

export function legacyMarkdownForImport(publicMarkdown: string, paidMarkdown: string): string {
  return paidMarkdown.trim()
    ? `${normalizeText(publicMarkdown).trim()}\n\n${PAID_GATE_TOKEN}\n\n${normalizeText(paidMarkdown).trim()}`
    : normalizeText(publicMarkdown).trim();
}
