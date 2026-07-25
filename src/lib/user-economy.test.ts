import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { claimDailySoda, drawDailySoda, getDailyCheckinState } from "./user-economy";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-economy-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function sequenceRandom(...values: number[]) {
  let index = 0;
  return (maxExclusive: number) => {
    const value = values[index++] ?? 0;
    assert.ok(value >= 0 && value < maxExclusive);
    return value;
  };
}

test("daily soda draw has a 20-point ceiling and an exact mean of five", () => {
  assert.equal(drawDailySoda(sequenceRandom(0, 0)), 1);
  assert.equal(drawDailySoda(sequenceRandom(94, 7)), 8);
  assert.equal(drawDailySoda(sequenceRandom(95, 0)), 9);
  assert.equal(drawDailySoda(sequenceRandom(99, 11)), 20);
  assert.equal(0.95 * ((1 + 8) / 2) + 0.05 * ((9 + 20) / 2), 5);
});

test("daily check-in grants soda once per site day", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('reader', '读者', 'hash')")
    .run().lastInsertRowid);
  const firstDay = new Date("2026-07-26T04:00:00.000Z");
  const secondDay = new Date("2026-07-27T04:00:00.000Z");

  assert.deepEqual(claimDailySoda(userId, firstDay, sequenceRandom(0, 4)), {
    ok: true,
    reward: 5,
    balance: 5,
    alreadyCheckedIn: false,
  });
  assert.deepEqual(claimDailySoda(userId, firstDay, sequenceRandom(99, 11)), {
    ok: true,
    reward: 5,
    balance: 5,
    alreadyCheckedIn: true,
  });
  assert.deepEqual(getDailyCheckinState(userId, firstDay), { checkedIn: true, reward: 5 });
  assert.deepEqual(claimDailySoda(userId, secondDay, sequenceRandom(95, 0)), {
    ok: true,
    reward: 9,
    balance: 14,
    alreadyCheckedIn: false,
  });
});
