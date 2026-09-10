import assert from "node:assert/strict";
import test from "node:test";
import { contentVersionForText, isContentVersion } from "./content-version";

test("content versions have one explicit decoded-text contract", () => {
  const version = contentVersionForText("繁體龍門\n");
  assert.match(version, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(isContentVersion(version), true);
  assert.equal(isContentVersion(version.slice("sha256:".length)), false);
  assert.equal(contentVersionForText("繁體龍門\n"), version);
  assert.notEqual(contentVersionForText("繁體龍門"), version);
});
