import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPlaybackHlsManifestCache,
  hlsSegmentsPubliclyCacheable,
  playbackHlsResourcePath,
  rewritePlaybackHlsManifest,
} from "./video-hls-delivery";
import { createSignedMediaHlsUrl, verifySignedMediaHlsUrl } from "./media-signing";

const MEDIA_ENV_NAMES = [
  "MEDIA_STORAGE_MODE",
  "MEDIA_PUBLIC_URL",
  "MEDIA_CONTROL_URL",
  "MEDIA_SIGNING_SECRET",
  "MEDIA_CONTROL_SECRET",
  "MEDIA_URL_TTL_SECONDS",
  "MEDIA_NODES_JSON",
  "MEDIA_NODE_ROUTES_JSON",
  "MEDIA_LEGACY_NODE_ID",
] as const;

function withMediaEnvironment(overrides: Partial<NodeJS.ProcessEnv>, run: () => void) {
  const previous = new Map(MEDIA_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of MEDIA_ENV_NAMES) {
    delete process.env[name];
  }
  Object.assign(process.env, {
    MEDIA_STORAGE_MODE: "remote",
    MEDIA_PUBLIC_URL: "https://media.example.com",
    MEDIA_CONTROL_URL: "http://10.0.0.2:3100",
    MEDIA_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
    MEDIA_CONTROL_SECRET: "abcdef0123456789abcdef0123456789",
    MEDIA_URL_TTL_SECONDS: "3600",
    MEDIA_NODES_JSON: JSON.stringify([{
      id: "video-a",
      publicUrl: "https://media2.example.com",
      controlUrl: "http://10.0.0.3:3100",
      signingSecret: "0123456789abcdef0123456789abcdef",
      controlSecret: "abcdef0123456789abcdef0123456789",
    }]),
    MEDIA_NODE_ROUTES_JSON: JSON.stringify({ video: "video-a" }),
    ...overrides,
  });
  try {
    run();
  } finally {
    for (const name of MEDIA_ENV_NAMES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    clearPlaybackHlsManifestCache();
  }
}

test("free published HLS is segment-cacheable; paid is not", () => {
  const base = {
    kind: "video" as const,
    playbackFormat: "hls" as const,
    playbackVersion: "1-1",
    playbackManifestPath: "video/.hls/9/1-1/index.m3u8",
  };
  assert.equal(hlsSegmentsPubliclyCacheable({ ...base, playSodaPrice: 0 }), true);
  assert.equal(hlsSegmentsPubliclyCacheable({ ...base, playSodaPrice: 1 }), false);
  assert.equal(hlsSegmentsPubliclyCacheable({
    ...base,
    playSodaPrice: 0,
    playbackManifestPath: null,
  }), false);
  assert.equal(hlsSegmentsPubliclyCacheable({
    kind: "audio",
    playSodaPrice: 0,
    playbackFormat: "hls",
    playbackVersion: "1-1",
    playbackManifestPath: "video/.hls/9/1-1/index.m3u8",
  }), false);
});

test("resource path rejects traversal and unknown names", () => {
  const root = "video/.hls/12/99-1/index.m3u8";
  assert.equal(playbackHlsResourcePath(root, "init.mp4"), "video/.hls/12/99-1/init.mp4");
  assert.equal(playbackHlsResourcePath(root, "bundle-0003.m4s"), "video/.hls/12/99-1/bundle-0003.m4s");
  assert.equal(playbackHlsResourcePath(root, "../secret"), null);
  assert.equal(playbackHlsResourcePath(root, "evil.ts"), null);
});

test("rewrite uses bucketed public signatures for free remote HLS", () => {
  withMediaEnvironment({}, () => {
    const raw = [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      "#EXT-X-TARGETDURATION:8",
      "#EXT-X-MAP:URI=\"init.mp4\"",
      "#EXTINF:8.0,",
      "bundle-0000.m4s",
      "#EXTINF:8.0,",
      "bundle-0001.m4s",
    ].join("\n");

    const now = 1_700_000_000_000;
    const first = rewritePlaybackHlsManifest(raw, {
      mediaId: 12,
      manifestPath: "video/.hls/12/99-1/index.m3u8",
      playbackVersion: "99-1",
      sessionId: "sess",
      token: "tok",
      storageNodeId: "video-a",
      segmentsPubliclyCacheable: true,
    });

    // Force same wall clock for second rewrite via createSigned path (Date.now inside).
    // Public bucket is 1h; signatures within the same second share exp.
    const lines = first.split("\n");
    const initUri = lines.find((l) => l.startsWith("#EXT-X-MAP"))?.match(/URI="([^"]+)"/)?.[1] || "";
    const seg0 = lines.find((l) => l.includes("bundle-0000")) || "";
    assert.match(initUri, /^https:\/\/media2\.example\.com\/media-hls\//);
    assert.match(seg0, /^https:\/\/media2\.example\.com\/media-hls\//);

    const initUrl = new URL(initUri);
    assert.equal(initUrl.searchParams.get("public"), "1");
    const verified = verifySignedMediaHlsUrl(initUrl, Date.now());
    assert.ok(verified);
    assert.equal(verified?.publiclyAccessible, true);
    assert.equal(verified?.storedPath, "video/.hls/12/99-1/init.mp4");

    // Same bucket window → identical public URL for same path
    const again = createSignedMediaHlsUrl({
      storageNodeId: "video-a",
      storedPath: "video/.hls/12/99-1/init.mp4",
      publiclyAccessible: true,
      now,
    });
    const again2 = createSignedMediaHlsUrl({
      storageNodeId: "video-a",
      storedPath: "video/.hls/12/99-1/init.mp4",
      publiclyAccessible: true,
      now: now + 30_000,
    });
    assert.equal(again, again2);
  });
});

test("rewrite keeps private lease-bound local paths for paid HLS", () => {
  withMediaEnvironment({ MEDIA_STORAGE_MODE: "local" }, () => {
    const raw = [
      "#EXTM3U",
      "#EXT-X-MAP:URI=\"init.mp4\"",
      "#EXTINF:6.0,",
      "bundle-0000.m4s",
    ].join("\n");
    const out = rewritePlaybackHlsManifest(raw, {
      mediaId: 5,
      manifestPath: "video/.hls/5/1-1/index.m3u8",
      playbackVersion: "1-1",
      sessionId: "lease-id",
      token: "lease-token",
      storageNodeId: null,
      segmentsPubliclyCacheable: false,
    });
    assert.match(out, /\/media\/5\/hls\/segment\?file=init\.mp4&v=1-1&ps=lease-id&pt=lease-token/);
    assert.match(out, /file=bundle-0000\.m4s&v=1-1&ps=lease-id&pt=lease-token/);
  });
});

test("free local rewrite omits lease query so responses can be shared", () => {
  withMediaEnvironment({ MEDIA_STORAGE_MODE: "local" }, () => {
    const raw = [
      "#EXTM3U",
      "#EXT-X-MAP:URI=\"init.mp4\"",
      "#EXTINF:6.0,",
      "bundle-0000.m4s",
    ].join("\n");
    const out = rewritePlaybackHlsManifest(raw, {
      mediaId: 5,
      manifestPath: "video/.hls/5/1-1/index.m3u8",
      playbackVersion: "1-1",
      sessionId: "lease-id",
      token: "lease-token",
      storageNodeId: null,
      segmentsPubliclyCacheable: true,
    });
    assert.match(out, /\/media\/5\/hls\/segment\?file=init\.mp4&v=1-1/);
    assert.match(out, /\/media\/5\/hls\/segment\?file=bundle-0000\.m4s&v=1-1/);
    assert.doesNotMatch(out, /ps=|pt=/);
  });
});
