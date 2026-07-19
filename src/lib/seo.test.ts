import assert from "node:assert/strict";
import test from "node:test";
import { absoluteSiteUrl, canonicalPagePath, getSiteUrl, getUmamiConfig } from "./seo";

test("SEO URL helpers normalize the public origin and pagination", () => {
  const env = { SITE_URL: "https://reader.example.com/path/", PORT: "3210" };
  assert.equal(getSiteUrl(env), "https://reader.example.com");
  assert.equal(absoluteSiteUrl("/books/12", env), "https://reader.example.com/books/12");
  assert.equal(canonicalPagePath("/tags/fantasy", 1), "/tags/fantasy");
  assert.equal(canonicalPagePath("/tags/fantasy", 3), "/tags/fantasy?page=3");
  assert.equal(getSiteUrl({ PORT: "3210" }), "http://localhost:3210");
});

test("Umami stays disabled unless both safe values are configured", () => {
  assert.equal(getUmamiConfig({}), null);
  assert.equal(
    getUmamiConfig({ UMAMI_WEBSITE_ID: "site-id", SCRIPT_URL: "javascript:alert(1)" }),
    null,
  );
  assert.deepEqual(
    getUmamiConfig({ UMAMI_WEBSITE_ID: "site-id", SCRIPT_URL: "https://stats.example.com/script.js" }),
    { websiteId: "site-id", scriptUrl: "https://stats.example.com/script.js", recorderUrl: null },
  );
});

test("Umami recorder uses an explicit safe URL or derives recorder.js when enabled", () => {
  assert.deepEqual(
    getUmamiConfig({
      UMAMI_WEBSITE_ID: "site-id",
      SCRIPT_URL: "https://stats.example.com/app/script.js?token=abc",
      UMAMI_RECORDER_ENABLED: "true",
    }),
    {
      websiteId: "site-id",
      scriptUrl: "https://stats.example.com/app/script.js?token=abc",
      recorderUrl: "https://stats.example.com/app/recorder.js?token=abc",
    },
  );
  assert.deepEqual(
    getUmamiConfig({
      UMAMI_WEBSITE_ID: "site-id",
      SCRIPT_URL: "https://stats.example.com/custom.js",
      UMAMI_RECORDER_URL: "https://replay.example.com/recorder.js",
    }),
    {
      websiteId: "site-id",
      scriptUrl: "https://stats.example.com/custom.js",
      recorderUrl: "https://replay.example.com/recorder.js",
    },
  );
  assert.equal(
    getUmamiConfig({
      UMAMI_WEBSITE_ID: "site-id",
      SCRIPT_URL: "https://stats.example.com/custom.js",
      UMAMI_RECORDER_ENABLED: "true",
    })?.recorderUrl,
    null,
  );
  assert.equal(
    getUmamiConfig({
      UMAMI_WEBSITE_ID: "site-id",
      SCRIPT_URL: "https://stats.example.com/script.js",
      UMAMI_RECORDER_URL: "javascript:alert(1)",
    })?.recorderUrl,
    null,
  );
});
