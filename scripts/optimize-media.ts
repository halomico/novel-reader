import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { getMediaDir } from "../src/lib/config";
import { inspectMp4AtomLayout } from "../src/lib/mp4-faststart";
import { optimizeMediaFileFastStart } from "../src/lib/media-processing";

const SUPPORTED_EXTENSIONS = new Set([".mp4", ".m4v", ".mov"]);
const dryRun = process.argv.includes("--dry-run");

function listVideoFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listVideoFiles(absolutePath));
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function optimizeFile(filePath: string): Promise<"optimized" | "skipped"> {
  const layout = inspectMp4AtomLayout(filePath);
  if (layout.fastStart) {
    console.log(`skip  ${path.relative(mediaRoot, filePath)} (already faststart)`);
    return "skipped";
  }
  if (layout.moovOffset === null || layout.mdatOffset === null) {
    throw new Error("not a supported MP4/MOV container");
  }
  console.log(`${dryRun ? "check" : "start"} ${path.relative(mediaRoot, filePath)}`);
  if (dryRun) {
    return "skipped";
  }

  const result = await optimizeMediaFileFastStart(filePath);
  if (result !== "optimized") throw new Error("not a supported MP4/MOV container");
  console.log(`done  ${path.relative(mediaRoot, filePath)}`);
  return "optimized";
}

const mediaRoot = path.resolve(process.env.MEDIA_NODE_DIR || getMediaDir());

async function main() {
  const videoDirectory = path.join(mediaRoot, "video");
  fs.mkdirSync(videoDirectory, { recursive: true });
  const files = listVideoFiles(videoDirectory);
  let optimized = 0;
  let failed = 0;
  for (const filePath of files) {
    try {
      if (await optimizeFile(filePath) === "optimized") optimized += 1;
    } catch (error) {
      failed += 1;
      console.error(`fail  ${path.relative(mediaRoot, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`summary: ${optimized} optimized, ${files.length - optimized - failed} skipped, ${failed} failed`);
  if (optimized > 0) {
    console.log("next: run media synchronization in the main admin after all files finish");
  }
  if (failed) process.exitCode = 1;
}

void main();
