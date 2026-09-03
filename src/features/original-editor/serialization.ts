export const LEGACY_PAID_MARKER = "<!-- original-paid -->";
export const PAID_GATE_TOKEN = "NOVEL_READER_PAID_GATE_NODE_V1";

export type OriginalOutlineItem = {
  id: string;
  level: 2 | 3;
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
  if (format & 8) text = `~~${text}~~`;
  if (format & 4) text = `<u>${text}</u>`;
  if (format & 2) text = `*${text}*`;
  if (format & 1) text = `**${text}**`;
  return text;
}

function plainText(node: SerializedNode): string {
  if (node.type === "text") return normalizeText(node.text);
  if (node.type === "linebreak") return "\n";
  return (node.children || []).map(plainText).join("");
}

function stableHeadingId(value: unknown, index: number): string {
  const candidate = String(value || "").trim();
  if (/^heading_[A-Za-z0-9_-]{8,80}$/u.test(candidate)) return candidate;
  return `heading_legacy_${String(index + 1).padStart(4, "0")}`;
}

function serializeBlock(
  node: SerializedNode,
  state: {
    paid: boolean;
    outline: OriginalOutlineItem[];
    publicAssets: Set<number>;
    paidAssets: Set<number>;
    headingIndex: number;
  },
  depth = 0,
): string {
  const children = node.children || [];
  if (node.type === "paragraph") return children.map(serializeInline).join("").trimEnd();
  if (node.type === "heading" || node.type === "original-heading") {
    const text = plainText(node).trim();
    const level: 2 | 3 = node.tag === "h3" ? 3 : 2;
    const id = stableHeadingId(node.anchorId, state.headingIndex++);
    if (text) state.outline.push({ id, level, text, paid: state.paid });
    return text ? `<!-- original-heading:${id} -->\n${"#".repeat(level)} ${escapeMarkdown(text)}` : "";
  }
  if (node.type === "quote") {
    return children.map((child) => serializeBlock(child, state, depth + 1)).join("\n\n")
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
    return children.map((child, index) => {
      const content = serializeBlock(child, state, depth + 1).replace(/\n/g, "\n  ");
      return `${ordered ? `${index + 1}.` : "-"} ${content}`;
    }).join("\n");
  }
  if (node.type === "listitem") {
    return children.map((child) => serializeBlock(child, state, depth + 1)).filter(Boolean).join("\n\n");
  }
  return children.map((child) => serializeBlock(child, state, depth + 1)).filter(Boolean).join("\n\n");
}

function countReadableCharacters(markdown: string): number {
  const text = markdown
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/```[^]*?```/g, (block) => block.replace(/^```[^\n]*|```$/g, ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ""))
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return Array.from(text).length;
}

export function parseEditorStateJson(value: string): SerializedEditorState {
  if (Buffer.byteLength(value, "utf8") > MAX_EDITOR_JSON_BYTES) throw new Error("编辑器内容超过可保存上限");
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
    publicWordCount: countReadableCharacters(publicMarkdown),
    paidWordCount: countReadableCharacters(paidMarkdown),
    paidGateCount,
  };
}

export function legacyMarkdownForImport(publicMarkdown: string, paidMarkdown: string): string {
  return paidMarkdown.trim()
    ? `${normalizeText(publicMarkdown).trim()}\n\n${PAID_GATE_TOKEN}\n\n${normalizeText(paidMarkdown).trim()}`
    : normalizeText(publicMarkdown).trim();
}
