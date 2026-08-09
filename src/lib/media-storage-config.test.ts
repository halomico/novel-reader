import assert from "node:assert/strict";
import test from "node:test";
import {
  getMediaPublicUrlForAsset,
  getMediaPublicUrlForKind,
  getMediaStorageMode,
  getRemoteMediaNodeForKind,
  getRemoteMediaStorageConfig,
  getRemoteMediaStorageRegistry,
  MediaStorageConfigurationError,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";

test("keeps local storage as the default without enabling a mixed delivery mode", () => {
  const env = {
    NODE_ENV: "test",
    MEDIA_PUBLIC_URL: "https://media.example.com",
    MEDIA_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
  } as NodeJS.ProcessEnv;
  assert.equal(getMediaStorageMode(env), "local");
  assert.throws(() => getRemoteMediaStorageConfig(env), MediaStorageConfigurationError);
});

test("requires a complete remote control and delivery configuration", () => {
  const valid = {
    NODE_ENV: "test",
    MEDIA_STORAGE_MODE: "remote",
    MEDIA_PUBLIC_URL: "https://media.example.com",
    MEDIA_CONTROL_URL: "http://10.0.0.2:3100",
    MEDIA_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
    MEDIA_CONTROL_SECRET: "abcdef0123456789abcdef0123456789",
  } as NodeJS.ProcessEnv;
  assert.deepEqual(getRemoteMediaStorageConfig(valid), {
    id: "default",
    publicUrl: "https://media.example.com",
    controlUrl: "http://10.0.0.2:3100",
    signingSecret: valid.MEDIA_SIGNING_SECRET,
    controlSecret: valid.MEDIA_CONTROL_SECRET,
    ttlSeconds: 21_600,
    maxVideoStreams: 0,
    videoBandwidthMbps: 0,
  });
  assert.throws(
    () => getRemoteMediaStorageConfig({ ...valid, MEDIA_CONTROL_SECRET: "" }),
    MediaStorageConfigurationError,
  );
  assert.throws(
    () => getMediaStorageMode({ NODE_ENV: "test", MEDIA_STORAGE_MODE: "typo" } as NodeJS.ProcessEnv),
    MediaStorageConfigurationError,
  );
});

test("routes each media kind through an explicit multi-node registry", () => {
  const videoSecret = "video-signing-secret-0123456789abcdef";
  const videoControlSecret = "video-control-secret-0123456789abcdef";
  const audioSecret = "audio-signing-secret-0123456789abcdef";
  const audioControlSecret = "audio-control-secret-0123456789abcdef";
  const env = {
    NODE_ENV: "test",
    MEDIA_STORAGE_MODE: "remote",
    MEDIA_NODES_JSON: JSON.stringify([
      {
        id: "video-node",
        publicUrl: "https://video.example.com",
        controlUrl: "http://10.0.0.10:3100",
        signingSecret: videoSecret,
        controlSecret: videoControlSecret,
      },
      {
        id: "audio-node",
        publicUrl: "https://audio.example.com",
        controlUrl: "http://10.0.0.11:3100",
        signingSecret: audioSecret,
        controlSecret: audioControlSecret,
      },
    ]),
    MEDIA_NODE_ROUTES_JSON: JSON.stringify({
      video: "video-node",
      audio: "audio-node",
      file: "video-node",
    }),
    MEDIA_LEGACY_NODE_ID: "video-node",
  } as NodeJS.ProcessEnv;

  const registry = getRemoteMediaStorageRegistry(env);
  assert.deepEqual(registry.routes, {
    video: "video-node",
    audio: "audio-node",
    file: "video-node",
  });
  assert.equal(getRemoteMediaNodeForKind("audio", env).publicUrl, "https://audio.example.com");
  assert.equal(getMediaPublicUrlForKind("audio", env), "https://audio.example.com");
  assert.equal(getMediaPublicUrlForAsset("video-node", "audio", env), "https://video.example.com");
  assert.equal(resolveRemoteMediaNodeForAsset("video-node", "audio", env).publicUrl, "https://video.example.com");
  assert.equal(resolveRemoteMediaNodeForAsset(null, "audio", env).id, "video-node");
});

test("uses one JSON media node for every kind without a route map", () => {
  const env = {
    NODE_ENV: "test",
    MEDIA_STORAGE_MODE: "remote",
    MEDIA_NODES_JSON: JSON.stringify([{
      id: "primary",
      publicUrl: "https://media.example.com",
      controlUrl: "http://10.0.0.2:3100",
      signingSecret: "primary-signing-secret-0123456789abcdef",
      controlSecret: "primary-control-secret-0123456789abcdef",
    }]),
  } as NodeJS.ProcessEnv;
  assert.deepEqual(getRemoteMediaStorageRegistry(env).routes, {
    video: "primary",
    audio: "primary",
    file: "primary",
  });
});

test("requires explicit routes when more than one media node is configured", () => {
  const env = {
    NODE_ENV: "test",
    MEDIA_STORAGE_MODE: "remote",
    MEDIA_NODES_JSON: JSON.stringify([
      {
        id: "one",
        publicUrl: "https://one.example.com",
        controlUrl: "https://one-control.example.com",
        signingSecret: "one-signing-secret-0123456789abcdef",
        controlSecret: "one-control-secret-0123456789abcdef",
      },
      {
        id: "two",
        publicUrl: "https://two.example.com",
        controlUrl: "https://two-control.example.com",
        signingSecret: "two-signing-secret-0123456789abcdef",
        controlSecret: "two-control-secret-0123456789abcdef",
      },
    ]),
  } as NodeJS.ProcessEnv;
  assert.throws(() => getRemoteMediaStorageRegistry(env), MediaStorageConfigurationError);
});
