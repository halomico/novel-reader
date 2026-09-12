import React, { type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { preserveOriginalMarkdownSpacing } from "@/lib/original-constants";
import { originalHeadingId, originalHeadingIdsByLine } from "@/lib/original-outline";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Raw HTML stays disabled — user articles must not be able to inject markup. Underline
 * is the one element the editor emits, so `<u>` is swapped for private-use sentinels
 * before parsing and turned back into a real element afterwards. Nothing else in the
 * document can produce these code points, and text inside code blocks is restored
 * verbatim so a literal `<u>` in a sample still reads as `<u>`.
 */
const UNDERLINE_OPEN_SENTINEL = "\uE000";
const UNDERLINE_CLOSE_SENTINEL = "\uE001";

/**
 * Fences are tracked the way CommonMark defines them: a run of three or more backticks
 * or tildes opens a block, and only a run of the same character at least as long, with
 * nothing after it, closes it. Toggling on every fence line instead would put a document
 * that quotes a fenced block inside a longer fence permanently "inside" one, and every
 * underline after that point would be dropped as disallowed raw HTML.
 */
function encodeUnderlineTags(value: string): string {
  let fence: { marker: string; length: number } | null = null;
  return value.split("\n").map((line) => {
    const run = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (run) {
      const marker = run[1][0];
      const length = run[1].length;
      if (!fence) {
        fence = { marker, length };
        return line;
      }
      if (marker === fence.marker && length >= fence.length && !run[2].trim()) fence = null;
      return line;
    }
    if (fence) return line;
    return line
      .replace(/[\uE000\uE001]/gu, " ")
      .replace(/<u>/giu, UNDERLINE_OPEN_SENTINEL)
      .replace(/<\/u>/giu, UNDERLINE_CLOSE_SENTINEL);
  }).join("\n");
}

function decodeSentinels(value: string): string {
  return value.replace(/\uE000/gu, "<u>").replace(/\uE001/gu, "</u>");
}

const MARK_PATTERN = new RegExp(`${UNDERLINE_OPEN_SENTINEL}([^${UNDERLINE_OPEN_SENTINEL}${UNDERLINE_CLOSE_SENTINEL}\n]+)${UNDERLINE_CLOSE_SENTINEL}`, "gu");

function markText(value: string): HastNode[] {
  const nodes: HastNode[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(MARK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push({ type: "text", value: decodeSentinels(value.slice(lastIndex, index)) });
    nodes.push({
      type: "element",
      tagName: "u",
      properties: {},
      children: [{ type: "text", value: decodeSentinels(match[1] ?? "") }],
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) nodes.push({ type: "text", value: decodeSentinels(value.slice(lastIndex)) });
  return nodes.length ? nodes : [{ type: "text", value: decodeSentinels(value) }];
}

function rehypeUnderline() {
  return (tree: HastNode) => {
    const visit = (node: HastNode, insideCode: boolean) => {
      if (!node.children) return;
      const code = insideCode || node.tagName === "code" || node.tagName === "pre";
      const children: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string") {
          if (code) children.push({ ...child, value: decodeSentinels(child.value) });
          else children.push(...markText(child.value));
          continue;
        }
        visit(child, code);
        children.push(child);
      }
      node.children = children;
    };
    visit(tree, false);
  };
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? href : null;
  } catch {
    return null;
  }
}

/** Shared safe Markdown renderer for user-authored articles and replies. */
export function OriginalMarkdown({ children }: { children: string }) {
  let headingIndex = 0;
  let imageIndex = 0;
  const spaced = preserveOriginalMarkdownSpacing(children);
  // Heading ids come from the same scan the outline uses, keyed by source line, so a
  // table of contents entry and the heading it points at can never drift apart.
  const headingIds = originalHeadingIdsByLine(spaced);
  const source = encodeUnderlineTags(spaced);
  const sourceLines = source.split("\n");
  const paragraphGap = (line: number | undefined) => {
    let gap = 0;
    for (let index = (line || 1) - 2; index >= 0 && sourceLines[index]?.trim() === ""; index -= 1) gap += 1;
    return gap;
  };
  const renderHeading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => ({
    children: headingChildren,
    node,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement> & { children?: React.ReactNode; node?: { position?: { start: { line: number } } } }) => {
    const id = headingIds.get(node?.position?.start.line ?? -1) || originalHeadingId(headingIndex);
    headingIndex += 1;
    return <Tag {...props} id={id}>{headingChildren}</Tag>;
  };
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeUnderline]}
      components={{
        a: ({ children: linkChildren, href }) => {
          const target = safeHref(href);
          return target ? <a href={target} rel="noreferrer noopener">{linkChildren}</a> : <span>{linkChildren}</span>;
        },
        img: ({ alt, src, title, node }) => {
          // Uploaded assets retain the existing endpoint's access checks.
          if (typeof src !== "string" || !/^\/original\/assets\/[1-9]\d*$/.test(src)) return alt ? <span>{alt}</span> : null;
          const size = /^<!-- original-image-size:(\d+)x(\d+) -->$/.exec(sourceLines[node?.position?.end.line || 0]?.trim() || "");
          return <span className="originalInlineImage">
            <img src={src} alt={alt || ""} width={size ? Number(size[1]) : undefined} height={size ? Number(size[2]) : undefined} loading={imageIndex++ === 0 ? "eager" : "lazy"} decoding="async" />
            {title ? <span className="originalImageCaption">{title}</span> : null}
          </span>;
        },
        p: ({ children: paragraphChildren, node }) => {
          const gap = paragraphGap(node?.position?.start.line);
          const style = gap
            ? { "--original-source-gap": `${Math.min(.9 + Math.max(gap - 1, 0) * .65, 3.5)}em` } as CSSProperties
            : undefined;
          return <p className="originalMarkdownParagraph" style={style}>{paragraphChildren}</p>;
        },
        pre: ({ children: codeChildren }) => <pre className="originalMarkdownCodeBlock">{codeChildren}</pre>,
        table: ({ children: tableChildren }) => <div className="originalMarkdownTable"><table>{tableChildren}</table></div>,
        h1: renderHeading("h1"),
        h2: renderHeading("h2"),
        h3: renderHeading("h3"),
        h4: renderHeading("h4"),
        h5: renderHeading("h5"),
        h6: renderHeading("h6"),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
