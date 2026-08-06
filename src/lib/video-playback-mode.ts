export type VideoPlaybackMode = "mp4" | "migration" | "hls-only";

export function getVideoPlaybackMode(
  env: Record<string, string | undefined> = process.env,
): VideoPlaybackMode {
  const value = (env.VIDEO_PLAYBACK_MODE || "migration").trim().toLowerCase();
  if (value === "mp4" || value === "migration" || value === "hls-only") {
    return value;
  }
  throw new Error("VIDEO_PLAYBACK_MODE 只能是 mp4、migration 或 hls-only");
}

export function videoPlaybackUsesHlsOnly(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getVideoPlaybackMode(env) === "hls-only";
}
