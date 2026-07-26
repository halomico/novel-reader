import assert from "node:assert/strict";
import test from "node:test";
import {
  getMediaStorageMode,
  getRemoteMediaStorageConfig,
  MediaStorageConfigurationError,
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
    publicUrl: "https://media.example.com",
    controlUrl: "http://10.0.0.2:3100",
    signingSecret: valid.MEDIA_SIGNING_SECRET,
    controlSecret: valid.MEDIA_CONTROL_SECRET,
    ttlSeconds: 21_600,
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
