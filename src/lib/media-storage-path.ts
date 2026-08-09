import path from "node:path";

export function normalizeMediaStoragePath(value: unknown): string | null {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  if (normalized.length > 600 || normalized.includes("\u0000")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

export function resolveMediaStoragePath(rootValue: string, storedName: string): string {
  const normalized = normalizeMediaStoragePath(storedName);
  if (!normalized) {
    throw new Error("资源路径无效");
  }
  const root = path.resolve(rootValue);
  const target = path.resolve(root, ...normalized.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("资源路径超出媒体目录");
  }
  return target;
}
