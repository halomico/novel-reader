import assert from "node:assert/strict";
import test from "node:test";
import { validateSameOriginMutation } from "./origin";

const previousSiteUrl = process.env.SITE_URL;
process.env.SITE_URL = "https://reader.example.com";

test.after(() => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
});

function request(headers: Record<string, string>): Request {
  return new Request("https://reader.example.com/api/test", {
    method: "POST",
    headers,
    body: "{}",
  });
}

test("same-origin JSON mutation with custom header passes", () => {
  assert.equal(validateSameOriginMutation(request({
    origin: "https://reader.example.com",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    "x-novel-mutation": "1",
  })), null);
});

test("same-site subdomain and missing mutation header are rejected", () => {
  assert.equal(validateSameOriginMutation(request({
    origin: "https://evil.example.com",
    "sec-fetch-site": "same-site",
    "content-type": "application/json",
    "x-novel-mutation": "1",
  }))?.status, 403);
  assert.equal(validateSameOriginMutation(request({
    origin: "https://reader.example.com",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
  }))?.status, 403);
});

test("non-JSON mutations require an explicit opt-out", () => {
  const upload = new Request("https://reader.example.com/api/upload", {
    method: "POST",
    headers: {
      origin: "https://reader.example.com",
      "sec-fetch-site": "same-origin",
      "content-type": "multipart/form-data; boundary=x",
      "x-novel-mutation": "1",
    },
    body: "--x--",
  });
  assert.equal(validateSameOriginMutation(upload)?.status, 415);
  assert.equal(validateSameOriginMutation(upload, { requireJson: false }), null);
});

test("development requests use the browser Host header when the framework normalizes the URL host", () => {
  const configuredSiteUrl = process.env.SITE_URL;
  delete process.env.SITE_URL;

  try {
    const localRequest = new Request("http://localhost:3108/api/test", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3108",
        origin: "http://127.0.0.1:3108",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-novel-mutation": "1",
      },
      body: "{}",
    });
    assert.equal(validateSameOriginMutation(localRequest), null);
  } finally {
    if (configuredSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = configuredSiteUrl;
  }
});

test("loopback mutation between localhost and 127.0.0.1 on identical port passes even when SITE_URL is configured", () => {
  const configuredSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = "http://localhost:3000";

  try {
    const loopbackRequest = new Request("http://127.0.0.1:3000/api/account/reading-progress", {
      method: "PUT",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-novel-mutation": "1",
      },
      body: "{}",
    });
    assert.equal(validateSameOriginMutation(loopbackRequest), null);

    const crossLoopbackRequest = new Request("http://localhost:3000/api/account/reading-progress", {
      method: "PUT",
      headers: {
        host: "localhost:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-site",
        "content-type": "application/json",
        "x-novel-mutation": "1",
      },
      body: "{}",
    });
    assert.equal(validateSameOriginMutation(crossLoopbackRequest), null);
  } finally {
    if (configuredSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = configuredSiteUrl;
  }
});
