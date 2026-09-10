import assert from "node:assert/strict";
import test from "node:test";
import { getContentRateLimitRules } from "./config";

test("blank optional rate-limit environment values do not enable a legacy policy", () => {
  const previousLimit = process.env.CONTENT_RATE_LIMIT_PER_MINUTE;
  const previousWindow = process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS;
  process.env.CONTENT_RATE_LIMIT_PER_MINUTE = "";
  process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS = "   ";
  try {
    assert.deepEqual(getContentRateLimitRules(), []);
  } finally {
    if (previousLimit === undefined) delete process.env.CONTENT_RATE_LIMIT_PER_MINUTE;
    else process.env.CONTENT_RATE_LIMIT_PER_MINUTE = previousLimit;
    if (previousWindow === undefined) delete process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS;
    else process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS = previousWindow;
  }
});

test("an explicit legacy rate-limit override remains bounded and complete", () => {
  const previousLimit = process.env.CONTENT_RATE_LIMIT_PER_MINUTE;
  const previousWindow = process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS;
  process.env.CONTENT_RATE_LIMIT_PER_MINUTE = "42";
  process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS = "30";
  try {
    assert.deepEqual(getContentRateLimitRules(), [{
      id: "content-general",
      enabled: true,
      scope: "all",
      queryType: "all",
      windowSeconds: 30,
      maxRequests: 42,
      banMode: "none",
      banSeconds: 3_600,
    }]);
  } finally {
    if (previousLimit === undefined) delete process.env.CONTENT_RATE_LIMIT_PER_MINUTE;
    else process.env.CONTENT_RATE_LIMIT_PER_MINUTE = previousLimit;
    if (previousWindow === undefined) delete process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS;
    else process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS = previousWindow;
  }
});
