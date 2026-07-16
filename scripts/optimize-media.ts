import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { getMediaDir } from "../src/lib/config";
import { inspectMp4AtomLayout } from "../src/lib/mp4-faststart";

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

function availableBytes(directory: string): number {
  const stat = fs.statfsSync(directory);
  return Number(stat.bavail) * Number(stat.bsize);
}

function runFfmpeg(sourcePath: string, targetPath: string): Promise<void> {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ["-hide_banner", "-loglevel", "warning", "-y", "-i", sourcePath, "-map", "0", "-c", "copy", "-map_metadata", "0", "-movflags", "+faststart", targetPath],
      { stdio: "inherit", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}`)));
  });
}

async function optimizeFile(filePath: string): Promise<"optimized" | "skipped"> {
  const layout = inspectMp4AtomLayout(filePath);
  if (layout.fastStart) {
    console.log(`skip  ${path.relative(getMediaDir(), filePath)} (already faststart)`);
    return "skipped";
  }
  if (layout.moovOffset === null || layout.mdatOffset === null) {
    throw new Error("not a supported MP4/MOV container");
  }
  console.log(`${dryRun ? "check" : "start"} ${path.relative(getMediaDir(), filePath)}`);
  if (dryRun) {
    return "skipped";
  }

  const stat = fs.statSync(filePath);
  if (availableBytes(path.dirname(filePath)) < stat.size + 256 * 1024 * 1024) {
    throw new Error("insufficient free disk space for the temporary remux file");
  }
  const extension = path.extname(filePath);
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath, extension)}.faststart-${crypto.randomBytes(6).toString("hex")}${extension}`);
  const replacePath = `${filePath}.faststart-replace`;
  try {
    await runFfmpeg(filePath, tempPath);
    if (!inspectMp4AtomLayout(tempPath).fastStart) {
      throw new Error("ffmpeg output still has the moov atom after media data");
    }
    fs.renameSync(filePath, replacePath);
    try {
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      fs.renameSync(replacePath, filePath);
      throw error;
    }
    try {
      fs.rmSync(replacePath, { force: true });
    } catch {
      console.warn(`warn  temporary replacement file remains: ${replacePath}`);
    }
    console.log(`done  ${path.relative(getMediaDir(), filePath)}`);
    return "optimized";
  } finally {
    fs.rmSync(tempPath, { force: true });
    if (fs.existsSync(replacePath) && !fs.existsSync(filePath)) {
      fs.renameSync(replacePath, filePath);
    }
  }
}

async function main() {
  const videoDirectory = path.join(getMediaDir(), "video");
  fs.mkdirSync(videoDirectory, { recursive: true });
  const files = listVideoFiles(videoDirectory);
  let optimized = 0;
  let failed = 0;
  for (const filePath of files) {
    try {
      if (await optimizeFile(filePath) === "optimized") optimized += 1;
    } catch (error) {
      failed += 1;
      console.error(`fail  ${path.relative(getMediaDir(), filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`summary: ${optimized} optimized, ${files.length - optimized - failed} skipped, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main();
