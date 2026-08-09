import assert from "node:assert/strict";
import test from "node:test";
import { isPublicPageCacheCandidate, type PublicPageCacheRequest } from "./public-page-cache";

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
});

test("does not cache RSC, prefetch, non-document, or mutation requests", () => {
  assert.equal(isPublicPageCacheCandidate(request("/novels", "_rsc=abc")), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { isRscRequest: true })), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { isRouterPrefetch: true })), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { accept: "application/json" })), false);
  assert.equal(isPublicPageCacheCandidate(request("/novels", "", { method: "POST" })), false);
});
