import path from "node:path";

export function parseNovelTitle(fileName: string): string {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  return baseName.replace(/^\d+_+/, "").trim();
}

export function isNovelTextFile(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() === ".txt";
}
