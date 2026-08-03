import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveVideoTranscodeProfile,
  selectVideoBitrateKbps,
  videoTranscodeArguments,
  videoTranscodeOutputStoredName,
  VIDEO_TRANSCODE_PROFILES,
} from "./video-transcode";

test("selects the configured single video transcode profile", () => {
  assert.equal(getActiveVideoTranscodeProfile({ VIDEO_TRANSCODE_PROFILE: "source" }), null);
  const profile = getActiveVideoTranscodeProfile({ VIDEO_TRANSCODE_PROFILE: "standard-h264" });
  assert.equal(profile?.label, "单文件 · 随分辨率");
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
