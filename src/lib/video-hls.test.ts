import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPlaybackHlsFileStream,
  estimatePlaybackHlsTemporaryBytes,
  planSingleFileHlsBundles,
  readPlaybackHlsManifest,
  readPublishedPlaybackHlsManifest,
  type PlaybackHlsFileSet,
} from "./video-hls";

test("reserves one source-sized output for direct HLS packaging", () => {
  const sourceSize = 600 * 1024 * 1024;
  const estimated = estimatePlaybackHlsTemporaryBytes(sourceSize, {
    width: 1920,
    height: 1080,
    videoCodec: "hevc",
    pixelFormat: "yuv420p10le",
    audioCodec: "aac",
    durationSeconds: 7_200,
  });
  assert.equal(estimated, sourceSize);
  assert.equal(estimatePlaybackHlsTemporaryBytes(1, {
    width: 1920,
    height: 1080,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
  }), 512 * 1024 * 1024);
});

const SINGLE_FILE_MANIFEST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="bundle-source.m4s",BYTERANGE="10@0"
#EXT-X-INDEPENDENT-SEGMENTS
#EXTINF:6.000000,
#EXT-X-BYTERANGE:8@10
bundle-source.m4s
#EXTINF:5.000000,
#EXT-X-BYTERANGE:9
bundle-source.m4s
#EXT-X-ENDLIST
`;

test("repackages one HLS byte-range object into bounded immutable bundles", () => {
  const plan = planSingleFileHlsBundles(SINGLE_FILE_MANIFEST, "bundle-source.m4s", 27, 12);
  assert.deepEqual(plan.initRange, { sourceStart: 0, length: 10 });
  assert.deepEqual(plan.bundles.map((bundle) => ({
    fileName: bundle.fileName,
    sizeBytes: bundle.sizeBytes,
    ranges: bundle.ranges,
  })), [
    {
      fileName: "bundle-0000.m4s",
      sizeBytes: 8,
      ranges: [{ sourceStart: 10, targetStart: 0, length: 8 }],
    },
    {
      fileName: "bundle-0001.m4s",
      sizeBytes: 9,
      ranges: [{ sourceStart: 18, targetStart: 0, length: 9 }],
    },
  ]);
  assert.match(plan.manifest, /#EXT-X-MAP:URI="init\.mp4"/u);
  assert.match(plan.manifest, /#EXT-X-BYTERANGE:8@0\nbundle-0000\.m4s/u);
  assert.match(plan.manifest, /#EXT-X-BYTERANGE:9@0\nbundle-0001\.m4s/u);
});

test("streams byte ranges across the virtual fragmented MP4 file boundary", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-hls-file-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = path.join(directory, "init.mp4");
  const second = path.join(directory, "bundle-0000.m4s");
  fs.writeFileSync(first, Buffer.from("ABCDE"));
  fs.writeFileSync(second, Buffer.from("FGHIJ"));
  const fileSet: PlaybackHlsFileSet = {
    files: [
      { fileName: "init.mp4", filePath: first, sizeBytes: 5 },
      { fileName: "bundle-0000.m4s", filePath: second, sizeBytes: 5 },
    ],
    sizeBytes: 10,
  };
  const chunks: Buffer[] = [];
  for await (const chunk of createPlaybackHlsFileStream(fileSet, 3, 7)) {
    chunks.push(Buffer.from(chunk));
  }
  assert.equal(Buffer.concat(chunks).toString("utf8"), "DEFGH");
});

test("accepts direct fMP4 segment manifests without byte ranges", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "video-hls-direct-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relativeManifest = "video/.hls/1/10-100/index.m3u8";
  const directory = path.join(root, "video", ".hls", "1", "10-100");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "init.mp4"), Buffer.from("init"));
  fs.writeFileSync(path.join(directory, "bundle-0000.m4s"), Buffer.from("segment"));
  fs.writeFileSync(path.join(directory, "index.m3u8"), `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXT-X-INDEPENDENT-SEGMENTS
#EXTINF:6.000000,
bundle-0000.m4s
#EXT-X-ENDLIST
`);

  assert.match(await readPlaybackHlsManifest(root, relativeManifest), /#EXT-X-ENDLIST/u);
});

test("published manifest reads trust publish-time fragment verification", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "video-hls-published-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relativeManifest = "video/.hls/1/10-100/index.m3u8";
  const directory = path.join(root, "video", ".hls", "1", "10-100");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "init.mp4"), Buffer.from("init"));
  fs.writeFileSync(path.join(directory, "bundle-0000.m4s"), Buffer.from("segment"));
  fs.writeFileSync(path.join(directory, "index.m3u8"), `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.000000,
bundle-0000.m4s
#EXT-X-ENDLIST
`);

  assert.match(await readPlaybackHlsManifest(root, relativeManifest), /#EXT-X-ENDLIST/u);
  fs.rmSync(path.join(directory, "bundle-0000.m4s"));
  assert.match(await readPublishedPlaybackHlsManifest(root, relativeManifest), /#EXT-X-ENDLIST/u);
  await assert.rejects(readPlaybackHlsManifest(root, relativeManifest));
});

test("rejects an HLS bundle truncated below a declared byte range", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "video-hls-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relativeManifest = "video/.hls/1/10-100/index.m3u8";
  const directory = path.join(root, "video", ".hls", "1", "10-100");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "init.mp4"), Buffer.from("init"));
  fs.writeFileSync(path.join(directory, "bundle-0000.m4s"), Buffer.from("1234"));
  fs.writeFileSync(path.join(directory, "index.m3u8"), `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.000000,
#EXT-X-BYTERANGE:5@0
bundle-0000.m4s
#EXT-X-ENDLIST
`);

  await assert.rejects(readPlaybackHlsManifest(root, relativeManifest), /播放资源不完整/u);
  fs.writeFileSync(path.join(directory, "bundle-0000.m4s"), Buffer.from("12345"));
  assert.match(await readPlaybackHlsManifest(root, relativeManifest), /#EXT-X-ENDLIST/u);
});
