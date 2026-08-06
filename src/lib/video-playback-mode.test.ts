import assert from "node:assert/strict";
import test from "node:test";
import { getVideoPlaybackMode, videoPlaybackUsesHlsOnly } from "./video-playback-mode";

test("selects an explicit video playback migration phase", () => {
  assert.equal(getVideoPlaybackMode({}), "migration");
  assert.equal(getVideoPlaybackMode({ VIDEO_PLAYBACK_MODE: "mp4" }), "mp4");
  assert.equal(getVideoPlaybackMode({ VIDEO_PLAYBACK_MODE: "HLS-ONLY" }), "hls-only");
  assert.equal(videoPlaybackUsesHlsOnly({ VIDEO_PLAYBACK_MODE: "hls-only" }), true);
  assert.throws(() => getVideoPlaybackMode({ VIDEO_PLAYBACK_MODE: "auto" }), /只能是/);
});
