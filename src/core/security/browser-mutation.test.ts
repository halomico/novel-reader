import assert from "node:assert/strict";
import test from "node:test";
import { jsonMutationRequest } from "./browser-mutation";

test("JSON mutation requests include the anti-CSRF contract and an empty object body", async () => {
  const request = new Request("http://localhost/api/test", jsonMutationRequest({ method: "POST" }));

  assert.equal(request.credentials, "same-origin");
  assert.equal(request.headers.get("content-type"), "application/json");
  assert.equal(request.headers.get("x-novel-mutation"), "1");
  assert.equal(await request.text(), "{}");
});

test("JSON mutation requests preserve their payload and extra headers", async () => {
  const request = new Request("http://localhost/api/test", jsonMutationRequest({
    method: "PATCH",
    headers: { "X-Request-Id": "request-1" },
    body: JSON.stringify({ title: "回城" }),
  }));

  assert.equal(request.headers.get("x-request-id"), "request-1");
  assert.deepEqual(await request.json(), { title: "回城" });
});
