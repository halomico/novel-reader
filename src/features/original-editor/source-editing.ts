export type SourceTool = "bold" | "italic" | "underline" | "strikethrough" | "inlineCode" | "h1" | "h2" | "paragraph" | "quote" | "code" | "unordered" | "ordered" | "divider" | "paid" | "clear";

export function editMarkdownSource(value: string, start: number, end: number, tool: SourceTool) {
  const selected = value.slice(start, end);
  const markers = { bold: "**", italic: "*", underline: "==", strikethrough: "~~", inlineCode: "`" };
  if (tool in markers) {
    const marker = markers[tool as keyof typeof markers];
    const wrapped = selected.startsWith(marker) && selected.endsWith(marker) && selected.length > marker.length * 2;
    const text = wrapped ? selected.slice(marker.length, -marker.length) : marker + selected + marker;
    const offset = wrapped ? 0 : marker.length;
    return { value: value.slice(0, start) + text + value.slice(end), start: start + offset, end: start + text.length - offset };
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
    if (tool === "clear") return content.replace(/(\*\*|__|~~|==|\*|_|`)(.*?)\1/g, "$2");
    if (tool === "quote" && unquote) return content;
    const prefix = { h1: "# ", h2: "## ", paragraph: "", quote: "> ", unordered: "- ", ordered: `${index + 1}. ` };
    return prefix[tool as keyof typeof prefix] + content;
  }).join("\n");
  return { value: value.slice(0, lineStart) + text + value.slice(lineEnd), start: lineStart, end: lineStart + text.length };
}
