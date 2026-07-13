import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMediaFile, parseMediaByteRange } from "./media";

test("normalizes supported native media files", () => {
  assert.deepEqual(normalizeMediaFile({ kind: "video", fileName: "demo.MP4", mimeType: "" }), {
    fileName: "demo.MP4",
    extension: ".mp4",
    mimeType: "video/mp4",
  });
  assert.equal(normalizeMediaFile({ kind: "audio", fileName: "demo.exe", mimeType: "application/octet-stream" }), null);
  assert.equal(normalizeMediaFile({ kind: "file", fileName: "", mimeType: "" }), null);
});

test("parses standard and suffix media ranges", () => {
  assert.deepEqual(parseMediaByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseMediaByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseMediaByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseMediaByteRange("bytes=100-", 100), "invalid");
  assert.equal(parseMediaByteRange("bytes=20-10", 100), "invalid");
  assert.equal(parseMediaByteRange(null, 100), null);
});
