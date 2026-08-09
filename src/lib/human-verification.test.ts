import assert from "node:assert/strict";
import test from "node:test";
import { verifyHumanRequest } from "./human-verification";

test("keeps human verification optional and validates Turnstile server-side", async () => {
  const previousProvider = process.env.HUMAN_VERIFICATION_PROVIDER;
  const previousSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const previousSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = globalThis.fetch;

  try {
    process.env.HUMAN_VERIFICATION_PROVIDER = "off";
    globalThis.fetch = async () => {
      throw new Error("verification should not call the network while disabled");
    };
    assert.deepEqual(await verifyHumanRequest(new FormData(), "login", "203.0.113.5"), { ok: true });

    process.env.HUMAN_VERIFICATION_PROVIDER = "turnstile";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    const formData = new FormData();
    formData.set("cf-turnstile-response", "verified-token");
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      assert.equal(init?.method, "POST");
      assert.equal((init?.body as URLSearchParams).get("secret"), "secret-key");
      assert.equal((init?.body as URLSearchParams).get("response"), "verified-token");
      assert.equal((init?.body as URLSearchParams).get("remoteip"), "203.0.113.5");
      return Response.json({ success: true, action: "login" });
    };
    assert.deepEqual(await verifyHumanRequest(formData, "login", "203.0.113.5"), { ok: true });

    globalThis.fetch = async () => Response.json({ success: true, action: "register" });
    const mismatched = await verifyHumanRequest(formData, "login", "203.0.113.5");
    assert.equal(mismatched.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousProvider === undefined) delete process.env.HUMAN_VERIFICATION_PROVIDER;
    else process.env.HUMAN_VERIFICATION_PROVIDER = previousProvider;
    if (previousSiteKey === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previousSiteKey;
    if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previousSecret;
  }
});
