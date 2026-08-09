import assert from "node:assert/strict";
import test from "node:test";
import { detectSiteIconFormat, MAX_SITE_ICON_BYTES } from "./site-icon";

test("site icon upload limit is 15 MB", () => {
  assert.equal(MAX_SITE_ICON_BYTES, 15 * 1024 * 1024);
});

test("detects supported site icon signatures", () => {
  assert.deepEqual(
    detectSiteIconFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    { extension: "png", mimeType: "image/png" },
  );
  assert.deepEqual(detectSiteIconFormat(Buffer.from([0xff, 0xd8, 0xff, 0x00])), {
    extension: "jpg",
    mimeType: "image/jpeg",
  });
  assert.deepEqual(detectSiteIconFormat(Buffer.from("RIFFxxxxWEBP", "ascii")), {
    extension: "webp",
    mimeType: "image/webp",
  });
  assert.deepEqual(detectSiteIconFormat(Buffer.from([0x00, 0x00, 0x01, 0x00])), {
    extension: "ico",
    mimeType: "image/x-icon",
  });
});

test("rejects unsupported site icon content", () => {
  assert.equal(detectSiteIconFormat(Buffer.from("<svg></svg>", "utf8")), null);
  assert.equal(detectSiteIconFormat(Buffer.from("not-an-image", "utf8")), null);
});
