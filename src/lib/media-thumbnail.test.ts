import assert from "node:assert/strict";
import test from "node:test";
import { mediaThumbnailEtag, thumbnailSeekSeconds } from "./media-thumbnail";
import { mediaThumbnailCacheHeaders, mediaThumbnailRedirectCacheHeaders } from "./media-thumbnail-http";

test("chooses the one-third point for video thumbnails", () => {
  assert.equal(thumbnailSeekSeconds(90), 30);
  assert.equal(thumbnailSeekSeconds(1.5), 0.5);
  assert.equal(thumbnailSeekSeconds(0), 0);
  assert.equal(thumbnailSeekSeconds(Number.NaN), 0);
});

test("honors the configured position for the single video thumbnail", () => {
  assert.equal(thumbnailSeekSeconds(100, 0.25), 25);
  assert.equal(thumbnailSeekSeconds(100, 0.5), 50);
  assert.equal(thumbnailSeekSeconds(100, 1), 0);
});

test("builds stable thumbnail cache validators", () => {
  assert.equal(mediaThumbnailEtag(7, 1234.9, 456), '"media-thumbnail-7-1234-456"');
});

test("only allows edge caching for publicly accessible thumbnails", () => {
  assert.deepEqual(mediaThumbnailCacheHeaders(true), {
    "Cache-Control": "public, max-age=86400, immutable",
    "Cloudflare-CDN-Cache-Control": "public, max-age=86400",
  });
  assert.deepEqual(mediaThumbnailCacheHeaders(false), {
    "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800, immutable",
    Vary: "Cookie",
  });
  assert.deepEqual(mediaThumbnailRedirectCacheHeaders(true), {
    "Cache-Control": "public, max-age=300",
    "Cloudflare-CDN-Cache-Control": "public, max-age=300",
  });
  assert.deepEqual(mediaThumbnailRedirectCacheHeaders(false), {
    "Cache-Control": "private, max-age=300",
    Vary: "Cookie",
  });
});
