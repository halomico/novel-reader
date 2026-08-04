import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveVideoTranscodeProfile,
  selectVideoProcessingMode,
  selectVideoBitrateKbps,
  videoProcessingArguments,
  videoTranscodeArguments,
  videoTranscodeOutputStoredName,
  VIDEO_TRANSCODE_PROFILES,
} from "./video-transcode";

test("selects the configured single video transcode profile", () => {
  assert.equal(getActiveVideoTranscodeProfile({ VIDEO_TRANSCODE_PROFILE: "source" }), null);
  const profile = getActiveVideoTranscodeProfile({ VIDEO_TRANSCODE_PROFILE: "standard-h264" });
  assert.equal(profile?.label, "智能兼容 · 无损优先");
  assert.equal(videoTranscodeOutputStoredName("video/演示/source.webm", profile!), "video/演示/source.mp4");
  assert.throws(() => getActiveVideoTranscodeProfile({ VIDEO_TRANSCODE_PROFILE: "unknown" }), /不受支持/);
});

test("selects one output bitrate from the source resolution", () => {
  const profile = VIDEO_TRANSCODE_PROFILES[0];
  assert.equal(selectVideoBitrateKbps(profile, { width: 640, height: 360 }), 600);
  assert.equal(selectVideoBitrateKbps(profile, { width: 1080, height: 1920 }), 2_800);
  assert.equal(selectVideoBitrateKbps(profile, { width: 3840, height: 2160 }), 4_500);
});

test("builds one H.264/AAC output without resizing the source", () => {
  const args = videoTranscodeArguments("input.part", "output.mp4", VIDEO_TRANSCODE_PROFILES[0], { width: 1920, height: 1080 });
  assert.deepEqual(args.slice(-5), ["-b:a", "128k", "-movflags", "+faststart", "output.mp4"]);
  assert.equal(args[args.indexOf("-b:v") + 1], "2800k");
  assert.equal(args[args.indexOf("-maxrate") + 1], "3080k");
  assert.equal(args.includes("-vf"), false);
  assert.equal(args.includes("-s"), false);
});

test("copies compatible streams and transcodes only incompatible codecs", () => {
  const compatible = {
    width: 1920,
    height: 1080,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
  };
  assert.equal(selectVideoProcessingMode(compatible, { sourceExtension: ".mp4", fastStart: true }), "passthrough");
  assert.equal(selectVideoProcessingMode(compatible, { sourceExtension: ".mp4", fastStart: false }), "remux");
  assert.equal(selectVideoProcessingMode(compatible, { sourceExtension: ".mov", fastStart: true }), "remux");
  assert.equal(selectVideoProcessingMode(compatible, { sourceExtension: ".ts", fastStart: false }), "remux");
  assert.equal(selectVideoProcessingMode({ ...compatible, audioCodec: "ac3" }, { sourceExtension: ".mov", fastStart: false }), "audio-transcode");
  assert.equal(selectVideoProcessingMode({ ...compatible, videoCodec: "hevc" }, { sourceExtension: ".mp4", fastStart: true }), "transcode");
  assert.equal(selectVideoProcessingMode({ ...compatible, videoCodec: "av1" }, { sourceExtension: ".webm", fastStart: false }), "transcode");
  assert.equal(selectVideoProcessingMode({ ...compatible, pixelFormat: "yuv420p10le" }, { sourceExtension: ".mp4", fastStart: true }), "transcode");

  const remuxArgs = videoProcessingArguments("input.mov", "output.mp4", VIDEO_TRANSCODE_PROFILES[0], compatible, "remux");
  assert.deepEqual(remuxArgs.slice(remuxArgs.indexOf("-c"), remuxArgs.indexOf("-c") + 2), ["-c", "copy"]);
  assert.equal(remuxArgs.includes("libx264"), false);

  const audioArgs = videoProcessingArguments(
    "input.mov",
    "output.mp4",
    VIDEO_TRANSCODE_PROFILES[0],
    { ...compatible, audioCodec: "ac3" },
    "audio-transcode",
  );
  assert.equal(audioArgs[audioArgs.indexOf("-c:v") + 1], "copy");
  assert.equal(audioArgs[audioArgs.indexOf("-c:a") + 1], "aac");

  const transcodeArgs = videoProcessingArguments(
    "input.webm",
    "output.mp4",
    VIDEO_TRANSCODE_PROFILES[0],
    { ...compatible, videoCodec: "av1" },
    "transcode",
  );
  assert.equal(transcodeArgs[transcodeArgs.indexOf("-c:v") + 1], "libx264");
  assert.equal(transcodeArgs[transcodeArgs.indexOf("-c:a") + 1], "copy");
  assert.deepEqual(transcodeArgs.slice(-5), ["-movflags", "+faststart", "-avoid_negative_ts", "make_zero", "output.mp4"]);
});
