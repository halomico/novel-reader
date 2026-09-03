import React, { type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { preserveOriginalMarkdownSpacing } from "@/lib/original-constants";
import { originalHeadingId } from "@/lib/original-outline";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function markText(value: string): HastNode[] {
  const pattern = /==([^=\n]+)==|~~([^~\n]+)~~/gu;
  const nodes: HastNode[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push({ type: "text", value: value.slice(lastIndex, index) });
    const tagName = match[1] !== undefined ? "u" : "del";
    nodes.push({ type: "element", tagName, properties: {}, children: [{ type: "text", value: match[1] ?? match[2] ?? "" }] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) nodes.push({ type: "text", value: value.slice(lastIndex) });
  return nodes.length ? nodes : [{ type: "text", value }];
}

/** Add the small forum-friendly ==underline== syntax without allowing HTML. */
function rehypeForumMarks() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.tagName === "code" || node.tagName === "pre") return;
      if (!node.children) return;
      const children: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string") {
          children.push(...markText(child.value));
        } else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children;
    };
    visit(tree);
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
  const source = preserveOriginalMarkdownSpacing(children);
  const sourceLines = source.split("\n");
  const paragraphGap = (line: number | undefined) => {
    let gap = 0;
    for (let index = (line || 1) - 2; index >= 0 && sourceLines[index]?.trim() === ""; index -= 1) gap += 1;
    return gap;
  };
  const renderHeading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => ({
    children: headingChildren,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement> & { children?: React.ReactNode }) => {
    const id = originalHeadingId(headingIndex);
    headingIndex += 1;
    return <Tag {...props} id={id}>{headingChildren}</Tag>;
  };
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeForumMarks]}
      components={{
        a: ({ children: linkChildren, href }) => {
          const target = safeHref(href);
          return target ? <a href={target} rel="noreferrer noopener">{linkChildren}</a> : <span>{linkChildren}</span>;
        },
        // Original is intentionally text-only: preserve an author's alt text
        // without fetching remote images during list/detail rendering.
        img: ({ alt }) => alt ? <span>{alt}</span> : null,
        p: ({ children: paragraphChildren, node }) => {
          const gap = paragraphGap(node?.position?.start.line);
          const style = gap
            ? { "--original-source-gap": `${Math.min(.9 + Math.max(gap - 1, 0) * .65, 3.5)}em` } as CSSProperties
            : undefined;
          return <p className="originalMarkdownParagraph" style={style}>{paragraphChildren}</p>;
        },
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
