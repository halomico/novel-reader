import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKS_PER_SITEMAP,
  getBookSitemapPageCount,
  parseBookSitemapPage,
  renderSitemapIndex,
  renderUrlSet,
} from "./sitemap";

test("book sitemap pages stay below the per-file URL limit", () => {
  assert.equal(getBookSitemapPageCount(0), 1);
  assert.equal(getBookSitemapPageCount(BOOKS_PER_SITEMAP), 1);
  assert.equal(getBookSitemapPageCount(BOOKS_PER_SITEMAP + 1), 2);
  assert.equal(parseBookSitemapPage("2.xml", 2), 2);
  assert.equal(parseBookSitemapPage("0.xml", 2), null);
  assert.equal(parseBookSitemapPage("3.xml", 2), null);
});

test("sitemap XML escapes URLs and renders valid optional fields", () => {
  const index = renderSitemapIndex(["https://example.com/sitemap/books/1.xml?a=1&b=2"]);
  assert.match(index, /<sitemapindex/);
  assert.match(index, /a=1&amp;b=2/);

  const urlSet = renderUrlSet([{
    url: "https://example.com/tags/a&b",
    lastModified: "2026-07-24T01:02:03.000Z",
    changeFrequency: "weekly",
    priority: 0.6,
  }]);
  assert.match(urlSet, /<urlset/);
  assert.match(urlSet, /a&amp;b/);
  assert.match(urlSet, /<lastmod>2026-07-24T01:02:03.000Z<\/lastmod>/);
  assert.match(urlSet, /<changefreq>weekly<\/changefreq><priority>0.6<\/priority>/);
});
