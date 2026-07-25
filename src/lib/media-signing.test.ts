import assert from "node:assert/strict";
import test from "node:test";
import { createSignedMediaUrl, getMediaNodeConfig, verifySignedMediaUrl } from "./media-signing";

test("signs media URLs and rejects tampering or expiry", () => {
  const previousPublicUrl = process.env.MEDIA_PUBLIC_URL;
  const previousSecret = process.env.MEDIA_SIGNING_SECRET;
  const previousTtl = process.env.MEDIA_URL_TTL_SECONDS;
  process.env.MEDIA_PUBLIC_URL = "https://media.example.com";
  process.env.MEDIA_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.MEDIA_URL_TTL_SECONDS = "600";
  try {
    assert.deepEqual(getMediaNodeConfig(), { publicUrl: "https://media.example.com", ttlSeconds: 600 });
    const signed = createSignedMediaUrl({
      storedName: "video/测试.mp4",
      mimeType: "video/mp4",
      fileName: "测试.mp4",
      download: false,
      now: 1_000_000,
    });
    assert.ok(signed);
    const parsed = new URL(signed);
    assert.deepEqual(verifySignedMediaUrl(parsed, 1_000_000), {
      storedName: "video/测试.mp4",
      expiresAt: 1_600,
      download: false,
      mimeType: "video/mp4",
      fileName: "测试.mp4",
    });
    parsed.searchParams.set("dl", "1");
    assert.equal(verifySignedMediaUrl(parsed, 1_000_000), null);
    assert.equal(verifySignedMediaUrl(new URL(signed), 1_601_000), null);
  } finally {
    if (previousPublicUrl === undefined) delete process.env.MEDIA_PUBLIC_URL;
    else process.env.MEDIA_PUBLIC_URL = previousPublicUrl;
    if (previousSecret === undefined) delete process.env.MEDIA_SIGNING_SECRET;
    else process.env.MEDIA_SIGNING_SECRET = previousSecret;
    if (previousTtl === undefined) delete process.env.MEDIA_URL_TTL_SECONDS;
    else process.env.MEDIA_URL_TTL_SECONDS = previousTtl;
  }
});

test("keeps the local media path when signing is not configured", () => {
  const previousPublicUrl = process.env.MEDIA_PUBLIC_URL;
  const previousSecret = process.env.MEDIA_SIGNING_SECRET;
  delete process.env.MEDIA_PUBLIC_URL;
  delete process.env.MEDIA_SIGNING_SECRET;
  try {
    assert.equal(getMediaNodeConfig(), null);
    assert.equal(
      createSignedMediaUrl({
        storedName: "audio/test.mp3",
        mimeType: "audio/mpeg",
        fileName: "test.mp3",
        download: false,
      }),
      null,
    );
  } finally {
    if (previousPublicUrl === undefined) delete process.env.MEDIA_PUBLIC_URL;
    else process.env.MEDIA_PUBLIC_URL = previousPublicUrl;
    if (previousSecret === undefined) delete process.env.MEDIA_SIGNING_SECRET;
    else process.env.MEDIA_SIGNING_SECRET = previousSecret;
  }
});

test("rejects media node URLs with credentials or a path prefix", () => {
  const previousPublicUrl = process.env.MEDIA_PUBLIC_URL;
  const previousSecret = process.env.MEDIA_SIGNING_SECRET;
  process.env.MEDIA_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
  try {
    process.env.MEDIA_PUBLIC_URL = "https://user:pass@media.example.com";
    assert.equal(getMediaNodeConfig(), null);
    process.env.MEDIA_PUBLIC_URL = "https://media.example.com/private";
    assert.equal(getMediaNodeConfig(), null);
  } finally {
    if (previousPublicUrl === undefined) delete process.env.MEDIA_PUBLIC_URL;
    else process.env.MEDIA_PUBLIC_URL = previousPublicUrl;
    if (previousSecret === undefined) delete process.env.MEDIA_SIGNING_SECRET;
    else process.env.MEDIA_SIGNING_SECRET = previousSecret;
  }
});
