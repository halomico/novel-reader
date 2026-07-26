import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectMp4AtomLayout } from "./mp4-faststart";
import { optimizeMediaFileFastStart } from "./media-processing";

function atom(type: string, payloadBytes: number): Buffer {
  const buffer = Buffer.alloc(8 + payloadBytes);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write(type, 4, 4, "ascii");
  return buffer;
}

test("detects whether the MP4 moov atom precedes media data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-mp4-"));
  try {
    const fastPath = path.join(directory, "fast.mp4");
    const slowPath = path.join(directory, "slow.mp4");
    fs.writeFileSync(fastPath, Buffer.concat([atom("ftyp", 8), atom("moov", 16), atom("mdat", 32)]));
    fs.writeFileSync(slowPath, Buffer.concat([atom("ftyp", 8), atom("mdat", 32), atom("moov", 16)]));
    assert.equal(inspectMp4AtomLayout(fastPath).fastStart, true);
    assert.equal(inspectMp4AtomLayout(slowPath).fastStart, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("skips remuxing an upload that is already faststart", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-mp4-ready-"));
  try {
    const filePath = path.join(directory, "ready.mp4");
    fs.writeFileSync(filePath, Buffer.concat([atom("ftyp", 8), atom("moov", 16), atom("mdat", 32)]));
    assert.equal(await optimizeMediaFileFastStart(filePath), "already-fast");
    assert.equal(inspectMp4AtomLayout(filePath).fastStart, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
