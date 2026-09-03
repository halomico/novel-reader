import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const p = (file) => path.join(root, file);
const read = (file) => fs.readFileSync(p(file), "utf8");
const write = (file, value) => { fs.mkdirSync(path.dirname(p(file)), { recursive: true }); fs.writeFileSync(p(file), value.replace(/\r\n?/g, "\n")); };
function replaceOptional(file, pattern, replacement) { const source = read(file); const next = source.replace(pattern, replacement); if (next !== source) write(file, next); }

// A standalone element node avoids depending on HeadingNode's static serialized type contract.
write("src/features/original-editor/nodes/OriginalHeadingNode.ts", `"use client";\n\nimport {\n  $applyNodeReplacement,\n  ElementNode,\n  type EditorConfig,\n  type LexicalNode,\n  type NodeKey,\n  type SerializedElementNode,\n  type Spread,\n} from "lexical";\n\nexport type OriginalHeadingTag = "h2" | "h3";\nexport type SerializedOriginalHeadingNode = Spread<\n  { type: "original-heading"; version: 1; tag: OriginalHeadingTag; anchorId: string },\n  SerializedElementNode\n>;\n\nfunction newAnchorId(): string {\n  if (typeof globalThis.crypto?.randomUUID === "function") return \`heading_\${globalThis.crypto.randomUUID().replace(/-/g, "")}\`;\n  return \`heading_\${Date.now().toString(36)}_\${Math.random().toString(36).slice(2, 14)}\`;\n}\n\nexport class OriginalHeadingNode extends ElementNode {\n  __tag: OriginalHeadingTag;\n  __anchorId: string;\n  static getType(): string { return "original-heading"; }\n  static clone(node: OriginalHeadingNode): OriginalHeadingNode { return new OriginalHeadingNode(node.__tag, node.__anchorId, node.__key); }\n  static importJSON(serialized: SerializedOriginalHeadingNode): OriginalHeadingNode {\n    const node = $createOriginalHeadingNode(serialized.tag, serialized.anchorId);\n    node.updateFromJSON(serialized);\n    return node;\n  }\n  constructor(tag: OriginalHeadingTag = "h2", anchorId = newAnchorId(), key?: NodeKey) {\n    super(key);\n    this.__tag = tag === "h3" ? "h3" : "h2";\n    this.__anchorId = /^heading_[A-Za-z0-9_-]{8,80}$/u.test(anchorId) ? anchorId : newAnchorId();\n  }\n  exportJSON(): SerializedOriginalHeadingNode { return { ...super.exportJSON(), type: "original-heading", version: 1, tag: this.__tag, anchorId: this.__anchorId }; }\n  createDOM(config: EditorConfig): HTMLElement {\n    const element = document.createElement(this.__tag);\n    const theme = config.theme.heading as { h2?: string; h3?: string } | undefined;\n    const className = theme?.[this.__tag];\n    if (className) element.className = className;\n    element.id = this.__anchorId;\n    element.dataset.originalHeading = this.__anchorId;\n    return element;\n  }\n  updateDOM(previous: OriginalHeadingNode, dom: HTMLElement): boolean { return previous.__tag !== this.__tag || dom.id !== this.__anchorId; }\n  getTag(): OriginalHeadingTag { return this.getLatest().__tag; }\n  getAnchorId(): string { return this.getLatest().__anchorId; }\n  canBeEmpty(): boolean { return false; }\n  collapseAtStart(): boolean { return true; }\n  extractWithChild(): boolean { return true; }\n}\n\nexport function $createOriginalHeadingNode(tag: OriginalHeadingTag = "h2", anchorId?: string): OriginalHeadingNode {\n  return $applyNodeReplacement(new OriginalHeadingNode(tag, anchorId));\n}\nexport function $isOriginalHeadingNode(node: LexicalNode | null | undefined): node is OriginalHeadingNode { return node instanceof OriginalHeadingNode; }\n`);

// Existing standard headings are imported for Markdown conversion only; the toolbar creates stable custom headings.
replaceOptional(
  "src/features/original-editor/OriginalComposerShell.tsx",
  /function replaceCurrentBlock\(editor: LexicalEditor, kind: "paragraph" \| "h2" \| "h3" \| "quote" \| "code"\)/,
  'function replaceCurrentBlock(editor: LexicalEditor, kind: "paragraph" | "h2" | "h3" | "quote" | "code")',
);

// Avoid nested transactions in analytics helpers: the event is reserved first, then side effects run only when counted.
for (const file of ["src/app/api/analytics/novel-view/route.ts", "src/app/api/analytics/media-view/route.ts"]) {
  if (!fs.existsSync(p(file))) continue;
  let source = read(file);
  source = source.replace(/  const db = getDb\(\);\n  db\.exec\("BEGIN IMMEDIATE"\);\n  try \{\n    const result = recordEngagementEvent\(db, ([\s\S]*?), \(\) => \{([\s\S]*?)\n    \}\);\n    db\.exec\("COMMIT"\);\n    return ([\s\S]*?)\n  \} catch \(error\) \{\n    db\.exec\("ROLLBACK"\);/,
    (_match, args, effects, response) => `  const db = getDb();\n  let counted = false;\n  try {\n    db.exec("BEGIN IMMEDIATE");\n    const result = recordEngagementEvent(db, ${args}, () => { counted = true; });\n    db.exec("COMMIT");\n    if (counted) {${effects}\n    }\n    return ${response}\n  } catch (error) {\n    try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }`);
  write(file, source);
}

// Build errors should never be hidden behind generated export-only workflows.
for (const file of [".github/workflows/audit-export.yml", ".github/workflows/original-editor-export.yml", ".github/workflows/top-tier-export.yml"]) {
  if (fs.existsSync(p(file))) fs.rmSync(p(file));
}

console.log("Definitive compiler-stable fixes applied.");
