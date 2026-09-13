import assert from "node:assert/strict";
import test from "node:test";
import { isPublicPageCacheCandidate, isPublicReaderPath, type PublicPageCacheRequest } from "./public-page-cache";

function request(
  pathname: string,
  search = "",
  overrides: Partial<PublicPageCacheRequest> = {},
): PublicPageCacheRequest {
  return {
    method: "GET",
    pathname,
    searchParams: new URLSearchParams(search),
    accept: "text/html,application/xhtml+xml",
    hasUserSession: false,
    hasBrowserLayoutPreference: false,
    isRscRequest: false,
    isRouterPrefetch: false,
    allowPublicNovelPages: true,
    ...overrides,
  };
}

test("caches only anonymous public catalog documents", () => {
  assert.equal(isPublicPageCacheCandidate(request("/")), true);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "page=3")), true);
  assert.equal(isPublicPageCacheCandidate(request("/tags")), true);
  assert.equal(isPublicPageCacheCandidate(request("/tags/fantasy", "page=2")), true);
  assert.equal(isPublicPageCacheCandidate(request("/books/12")), true);
  assert.equal(isPublicPageCacheCandidate(request("/books/12/chapters/3")), true);
  assert.equal(
    isPublicPageCacheCandidate(request("/books/12", "from=%2Fnovels%3Fpage%3D2")),
    true,
  );
  assert.equal(isPublicPageCacheCandidate(request("/original", "page=2")), true);
  assert.equal(isPublicPageCacheCandidate(request("/original/article-mtv")), true);
  assert.equal(isPublicPageCacheCandidate(request("/original/tags")), true);
  assert.equal(isPublicPageCacheCandidate(request("/original/tags/fantasy", "page=2")), true);
  assert.equal(isPublicPageCacheCandidate(request("/original/author/3", "page=2")), true);
  assert.equal(isPublicPageCacheCandidate(request("/announcements")), true);
  assert.equal(isPublicPageCacheCandidate(request("/announcements/10")), true);
});

test("keeps personalized and behavior-changing pages private", () => {
  assert.equal(isPublicPageCacheCandidate(request("/", "q=test")), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "q=test")), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "random=seed")), false);
  assert.equal(isPublicPageCacheCandidate(request("/tags", "hidden=1")), false);
  assert.equal(isPublicPageCacheCandidate(request("/books/1", "hit=3")), false);
  assert.equal(isPublicPageCacheCandidate(request("/books/1/chapters/2", "resume=1")), false);
  assert.equal(isPublicPageCacheCandidate(request("/books/1", "from=%2Fnovels%3Fq%3Dtest")), false);
  assert.equal(
    isPublicPageCacheCandidate(request("/books/1", "", { allowPublicNovelPages: false })),
    false,
  );
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { hasUserSession: true })), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { hasBrowserLayoutPreference: true })), false);
  assert.equal(isPublicPageCacheCandidate(request("/original", "q=test")), false);
  assert.equal(isPublicPageCacheCandidate(request("/original/article-mtv", "resume=1")), false);
  assert.equal(isPublicPageCacheCandidate(request("/original/article-mtv", "comments=2")), false);
  assert.equal(isPublicPageCacheCandidate(request("/original/tags", "q=abc")), false);
  assert.equal(isPublicPageCacheCandidate(request("/original/tags/fantasy", "sort=hot")), false);
  assert.equal(isPublicPageCacheCandidate(request("/original/author/abc")), false);
  assert.equal(isPublicPageCacheCandidate(request("/announcements", "page=2")), false);
  assert.equal(isPublicPageCacheCandidate(request("/media", "kind=video")), false, "media access rules run per kind");
  for (const reserved of ["/original/new", "/original/mine", "/original/write/9"]) {
    assert.equal(isPublicPageCacheCandidate(request(reserved)), false, reserved);
  }
});

test("does not cache RSC, prefetch, non-document, or mutation requests", () => {
  assert.equal(isPublicPageCacheCandidate(request("/novels", "_rsc=abc")), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { isRscRequest: true })), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { isRouterPrefetch: true })), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { accept: "application/json" })), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { method: "POST" })), false);
});

test("router fetches without visible flight headers never reach the edge cache", () => {
  // Next.js removes RSC headers and `_rsc` before middleware; router fetches send */*.
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { accept: "*/*" })), false);
  assert.equal(isPublicPageCacheCandidate(request("/books/12", "", { accept: null })), false);
});

test("reader paths get the longer edge lifetime", () => {
  assert.equal(isPublicReaderPath("/books/12"), true);
  assert.equal(isPublicReaderPath("/books/12/chapters/3"), true);
  assert.equal(isPublicReaderPath("/original/article-mtv"), true);
  assert.equal(isPublicReaderPath("/original"), false);
  assert.equal(isPublicReaderPath("/original/mine"), false);
  assert.equal(isPublicReaderPath("/novels"), false);
});
