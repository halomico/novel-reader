import assert from "node:assert/strict";
import test from "node:test";
import {
  createSignedMediaThumbnailUrl,
  createSignedMediaUrl,
  verifySignedMediaThumbnailUrl,
  verifySignedMediaUrl,
} from "./media-signing";
import { MediaStorageConfigurationError } from "./media-storage-config";

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
    MEDIA_URL_TTL_SECONDS: "600",
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
  }
}

test("signs media URLs and rejects tampering or expiry", () => {
  withMediaEnvironment({}, () => {
    const signed = createSignedMediaUrl({
      storedName: "video/测试.mp4",
      mimeType: "video/mp4",
      fileName: "测试.mp4",
      mtimeMs: 123_456,
      sizeBytes: 987_654,
      download: false,
      now: 1_000_000,
    });
    const parsed = new URL(signed);
    assert.deepEqual(verifySignedMediaUrl(parsed, 1_000_000), {
      storedName: "video/测试.mp4",
      expiresAt: 1_600,
      mtimeMs: 123_456,
      sizeBytes: 987_654,
      download: false,
      publiclyAccessible: false,
      mimeType: "video/mp4",
      fileName: "测试.mp4",
    });
    parsed.searchParams.set("dl", "1");
    assert.equal(verifySignedMediaUrl(parsed, 1_000_000), null);
    const staleVersion = new URL(signed);
    staleVersion.searchParams.set("v", "123457");
    assert.equal(verifySignedMediaUrl(staleVersion, 1_000_000), null);
    assert.equal(verifySignedMediaUrl(new URL(signed), 1_601_000), null);
  });
});

test("keeps public media signatures stable within a cache bucket", () => {
  withMediaEnvironment({}, () => {
    const input = {
      storedName: "video/public.mp4",
      mimeType: "video/mp4",
      fileName: "public.mp4",
      mtimeMs: 123_456,
      sizeBytes: 987_654,
      download: false,
      publiclyAccessible: true,
    };
    const signed = createSignedMediaUrl({ ...input, now: 1_000_000 });
    assert.equal(createSignedMediaUrl({ ...input, now: 1_100_000 }), signed);
    assert.equal(verifySignedMediaUrl(new URL(signed), 1_000_000)?.publiclyAccessible, true);
    const tampered = new URL(signed);
    tampered.searchParams.set("public", "0");
    assert.equal(verifySignedMediaUrl(tampered, 1_000_000), null);
  });
});

test("signs versioned media thumbnails with explicit cache visibility", () => {
  withMediaEnvironment({}, () => {
    const signed = createSignedMediaThumbnailUrl({
      storedName: "video/测试.mp4",
      mtimeMs: 123_456,
      sizeBytes: 987_654,
      percent: 33,
      publiclyAccessible: false,
      now: 1_000_000,
    });
    const sameBucket = createSignedMediaThumbnailUrl({
      storedName: "video/测试.mp4",
      mtimeMs: 123_456,
      sizeBytes: 987_654,
      percent: 33,
      publiclyAccessible: false,
      now: 1_100_000,
    });
    assert.equal(sameBucket, signed);
    assert.deepEqual(verifySignedMediaThumbnailUrl(new URL(signed), 1_000_000), {
      storedName: "video/测试.mp4",
      expiresAt: 1_800,
      mtimeMs: 123_456,
      sizeBytes: 987_654,
      percent: 33,
      publiclyAccessible: false,
    });
    const tampered = new URL(signed);
    tampered.searchParams.set("public", "1");
    assert.equal(verifySignedMediaThumbnailUrl(tampered, 1_000_000), null);
  });
});

test("signs each asset with its own configured media node", () => {
  const videoSecret = "video-signing-secret-0123456789abcdef";
  const audioSecret = "audio-signing-secret-0123456789abcdef";
  withMediaEnvironment({
    MEDIA_NODES_JSON: JSON.stringify([
      {
        id: "video-node",
        publicUrl: "https://video.example.com",
        controlUrl: "https://video-control.example.com",
        signingSecret: videoSecret,
        controlSecret: "video-control-secret-0123456789abcdef",
      },
      {
        id: "audio-node",
        publicUrl: "https://audio.example.com",
        controlUrl: "https://audio-control.example.com",
        signingSecret: audioSecret,
        controlSecret: "audio-control-secret-0123456789abcdef",
      },
    ]),
    MEDIA_NODE_ROUTES_JSON: JSON.stringify({
      video: "video-node",
      audio: "audio-node",
      file: "video-node",
    }),
  }, () => {
    const signed = createSignedMediaUrl({
      storageNodeId: "audio-node",
      storedName: "audio/test.mp3",
      mimeType: "audio/mpeg",
      fileName: "test.mp3",
      mtimeMs: 123_456,
      sizeBytes: 987_654,
      download: false,
      now: 1_000_000,
    });
    assert.equal(new URL(signed).origin, "https://audio.example.com");
    assert.equal(verifySignedMediaUrl(new URL(signed), 1_000_000, audioSecret)?.storedName, "audio/test.mp3");
    assert.equal(verifySignedMediaUrl(new URL(signed), 1_000_000, videoSecret), null);
  });
});

test("does not enable the old delivery-only media-node mode", () => {
  withMediaEnvironment({ MEDIA_STORAGE_MODE: "local" }, () => {
    assert.throws(
      () => createSignedMediaUrl({
        storedName: "audio/test.mp3",
        mimeType: "audio/mpeg",
        fileName: "test.mp3",
        mtimeMs: 123_456,
        sizeBytes: 987_654,
        download: false,
      }),
      MediaStorageConfigurationError,
    );
  });
});

test("rejects media node URLs with credentials or a path prefix", () => {
  withMediaEnvironment({ MEDIA_PUBLIC_URL: "https://user:pass@media.example.com" }, () => {
    assert.throws(
      () => createSignedMediaUrl({
        storedName: "audio/test.mp3",
        mimeType: "audio/mpeg",
        fileName: "test.mp3",
        mtimeMs: 123_456,
        sizeBytes: 987_654,
        download: false,
      }),
      MediaStorageConfigurationError,
    );
  });
  withMediaEnvironment({ MEDIA_PUBLIC_URL: "https://media.example.com/private" }, () => {
    assert.throws(
      () => createSignedMediaUrl({
        storedName: "audio/test.mp3",
        mimeType: "audio/mpeg",
        fileName: "test.mp3",
        mtimeMs: 123_456,
        sizeBytes: 987_654,
        download: false,
      }),
      MediaStorageConfigurationError,
    );
  });
});
