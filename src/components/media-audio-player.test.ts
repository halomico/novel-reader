import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("audio queue access tracking satisfies the same-origin mutation contract", () => {
  const source = readFileSync(path.join(process.cwd(), "src/components/MediaAudioPlayer.tsx"), "utf8");

  assert.match(source, /import \{ jsonMutationRequest \} from "@\/core\/security\/browser-mutation"/);
  assert.match(source, /\/access`,\s*jsonMutationRequest\(\{ method: "POST", keepalive: true \}\)/);
});
