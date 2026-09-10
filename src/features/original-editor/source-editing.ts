export type SourceTool = "bold" | "italic" | "underline" | "strikethrough" | "inlineCode" | "h1" | "h2" | "paragraph" | "quote" | "code" | "unordered" | "ordered" | "divider" | "paid" | "clear";

export function editMarkdownSource(value: string, start: number, end: number, tool: SourceTool) {
  const selected = value.slice(start, end);
  // Underline is the one inline format with distinct open and close markers, because
  // CommonMark has no underline and neither `_` nor `==` may be redefined to mean one.
  const markers: Record<string, readonly [string, string]> = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    underline: ["<u>", "</u>"],
    strikethrough: ["~~", "~~"],
    inlineCode: ["`", "`"],
  };
  if (tool in markers) {
    const [open, close] = markers[tool];
    const wrapped = selected.startsWith(open) && selected.endsWith(close) && selected.length > open.length + close.length;
    const text = wrapped ? selected.slice(open.length, -close.length) : open + selected + close;
    const startOffset = wrapped ? 0 : open.length;
    const endOffset = wrapped ? 0 : close.length;
    return { value: value.slice(0, start) + text + value.slice(end), start: start + startOffset, end: start + text.length - endOffset };
  }
  if (tool === "code" || tool === "divider" || tool === "paid") {
    const text = tool === "code" ? "```\n" + selected + "\n```" : tool === "divider" ? "---" : "<!-- original-paid -->";
    const left = value.slice(0, start);
    const right = value.slice(end);
    const before = !left ? "" : left.endsWith("\n\n") ? "" : left.endsWith("\n") ? "\n" : "\n\n";
    const after = !right ? "" : right.startsWith("\n\n") ? "" : right.startsWith("\n") ? "\n" : "\n\n";
    const cursor = start + before.length + (tool === "code" ? 4 : text.length + after.length);
    return { value: value.slice(0, start) + before + text + after + value.slice(end), start: cursor, end: tool === "code" ? cursor + selected.length : cursor };
  }
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  // When a selection ends immediately after a newline, that newline belongs to
  // the selected lines—not to the following paragraph. Probing from `end`
  // otherwise absorbs the next paragraph and made quote/list tools appear to
  // delete the user's line break.
  const endProbe = end > lineStart && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", endProbe);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const removePrefix = (line: string) => line.replace(/^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, "");
  const unquote = tool === "quote" && lines.every((line) => !line.trim() || /^>\s?/u.test(line));
  const text = lines.map((line, index) => {
    const content = removePrefix(line);
    if (tool === "clear") {
      return content
        .replace(/<u>(.*?)<\/u>/gu, "$1")
        // Links lose the target but keep their label; images stay whole.
        .replace(/(?<!!)\[([^\]]*)\]\([^)]*\)/gu, "$1")
        .replace(/(\*\*|__|~~|==|\*|_|`)(.*?)\1/gu, "$2");
    }
    if (tool === "quote" && unquote) return content;
    const prefix = { h1: "# ", h2: "## ", paragraph: "", quote: "> ", unordered: "- ", ordered: `${index + 1}. ` };
    return prefix[tool as keyof typeof prefix] + content;
  }).join("\n");
  return { value: value.slice(0, lineStart) + text + value.slice(lineEnd), start: lineStart, end: lineStart + text.length };
}
