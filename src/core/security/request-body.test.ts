import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBody, readFormBody } from "./request-body";

test("readJsonBody parses bounded JSON", async () => {
  const request = new Request("https://reader.example.com/api/test", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
    headers: { "content-type": "application/json" },
  });
  const result = await readJsonBody<{ ok: boolean }>(request, 64);
  assert.deepEqual(result, { ok: true, value: { ok: true } });
});

test("readJsonBody rejects oversized content before parsing", async () => {
  const request = new Request("https://reader.example.com/api/test", {
    method: "POST",
    body: JSON.stringify({ value: "1234567890" }),
    headers: { "content-type": "application/json", "content-length": "100000" },
  });
  const result = await readJsonBody(request, 64);
  assert.deepEqual(result, { ok: false, reason: "too_large" });
});

test("readJsonBody reports malformed JSON", async () => {
  const request = new Request("https://reader.example.com/api/test", {
    method: "POST",
    body: "{",
    headers: { "content-type": "application/json" },
  });
  const result = await readJsonBody(request);
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

test("JSON limit cancels chunked streams without trusting Content-Length", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(8));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const request = new Request("https://reader.example.com/api/test", {
      method: "POST", body: stream, headers, duplex: "half",
    } as RequestInit);
    assert.deepEqual(await readJsonBody(request, 12), { ok: false, reason: "too_large" });
    assert.equal(cancelled, true);
    assert.equal(pulls, 2);
  }
});

test("JSON requires an object and counts UTF-8 bytes across chunk boundaries", async () => {
  for (const body of ["null", "[]", "true", "12", '"text"']) {
    assert.deepEqual(await readJsonBody(new Request("https://reader.example.com", { method: "POST", body })), { ok: false, reason: "invalid" });
  }
  const bytes = new TextEncoder().encode('{"text":"中文"}');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  assert.deepEqual(await readJsonBody(new Request("https://reader.example.com", { method: "POST", body: stream, duplex: "half" } as RequestInit), bytes.length), { ok: true, value: { text: "中文" } });
  assert.deepEqual(await readJsonBody(new Request("https://reader.example.com", { method: "POST", body: bytes }), bytes.length - 1), { ok: false, reason: "too_large" });
});

test("multipart parser bounds raw input and retains file metadata", async () => {
  const form = new FormData();
  form.append("files", new File(["正文"], "chapter.txt", { type: "text/plain" }));
  const request = new Request("https://reader.example.com", { method: "POST", body: form });
  const oversized = await readFormBody(request.clone(), 16);
  assert.deepEqual(oversized, { ok: false, reason: "too_large" });
  const parsed = await readFormBody(request, 4096);
  assert.ok(parsed.ok);
  const file = parsed.value.get("files") as File;
  assert.equal(file.name, "chapter.txt");
  assert.equal(await file.text(), "正文");
});
