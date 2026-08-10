import assert from "node:assert/strict";
import test from "node:test";
import { createHlsConfig, HLS_STALL_RECOVERY_MS } from "./MediaPlayer";

test("keeps enough HLS buffer and tolerates slow cold fragment responses", () => {
  const config = createHlsConfig();
  const policy = config.fragLoadPolicy?.default;

  assert.equal(config.maxBufferLength, 45);
  assert.equal(config.maxMaxBufferLength, 90);
  assert.equal(config.maxBufferSize, 60 * 1000 * 1000);
  assert.equal(policy?.maxTimeToFirstByteMs, 25_000);
  assert.equal(policy?.maxLoadTimeMs, 120_000);
  assert.equal(policy?.timeoutRetry?.maxNumRetry, 4);
  assert.equal(policy?.errorRetry?.maxNumRetry, 6);
  assert.equal(HLS_STALL_RECOVERY_MS, 30_000);
});
