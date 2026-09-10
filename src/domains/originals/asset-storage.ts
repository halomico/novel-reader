import path from "node:path";

export function originalAssetRoot(): string {
  return path.resolve(process.env.ORIGINAL_ASSET_DIR || path.join(process.cwd(), "data", "original-assets"));
}
