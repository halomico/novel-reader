import assert from "node:assert/strict";
import test from "node:test";
import { createLoginCaptchaChallenge, loginCaptchaAnswersMatch, verifyLoginCaptcha } from "./login-captcha";

function pngBytes(dataUrl: string): Buffer {
  assert.match(dataUrl, /^data:image\/png;base64,/);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test("matches image captcha answers case-insensitively", () => {
  assert.equal(loginCaptchaAnswersMatch("image", "7KMP", " 7kmp "), true);
  assert.equal(loginCaptchaAnswersMatch("image", "7KMP", "7KNP"), false);
});

test("matches slider captcha positions within five units", () => {
  assert.equal(loginCaptchaAnswersMatch("slider", "120", "125"), true);
  assert.equal(loginCaptchaAnswersMatch("slider", "120", "126"), false);
  assert.equal(loginCaptchaAnswersMatch("slider", "120", "not-a-number"), false);
});

test("renders captcha challenges as PNG bitmaps", () => {
  for (const mode of ["image", "slider"] as const) {
    const challenge = createLoginCaptchaChallenge(mode, "login", 1_000);
    const bytes = pngBytes(challenge.imageUrl);
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test("renders slider background and transparent puzzle piece at stable dimensions", () => {
  const challenge = createLoginCaptchaChallenge("slider", "register", 2_000);
  const background = pngBytes(challenge.imageUrl);
  const piece = pngBytes(challenge.sliderPieceImageUrl || "");

  assert.deepEqual([background.readUInt32BE(16), background.readUInt32BE(20)], [320, 150]);
  assert.deepEqual([piece.readUInt32BE(16), piece.readUInt32BE(20)], [52, 52]);
  assert.equal(piece[25], 6);
});

test("rejects a captcha created for another authentication purpose", () => {
  const challenge = createLoginCaptchaChallenge("image", "login", 3_000);
  assert.equal(
    verifyLoginCaptcha({ id: challenge.id, mode: "image", purpose: "register", answer: "", now: 3_001 }),
    false,
  );
});
