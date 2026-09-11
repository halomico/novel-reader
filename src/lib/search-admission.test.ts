import assert from "node:assert/strict";
import test from "node:test";
import { acquireSearchSlot } from "./search-admission";

test("search admission grants up to the limit and hands freed slots over in arrival order", async () => {
  const first = await acquireSearchSlot(2, 1_000);
  const second = await acquireSearchSlot(2, 1_000);
  assert.ok(first && second);
  const order: string[] = [];
  const third = acquireSearchSlot(2, 1_000).then((granted) => { order.push("third"); return granted; });
  const fourth = acquireSearchSlot(2, 1_000).then((granted) => { order.push("fourth"); return granted; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, [], "searches beyond the limit wait instead of running");
  first.release();
  first.release();
  const thirdSlot = await third;
  assert.ok(thirdSlot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ["third"], "a double release frees one slot, not two");
  second.release();
  const fourthSlot = await fourth;
  assert.ok(fourthSlot);
  assert.deepEqual(order, ["third", "fourth"]);
  thirdSlot.release();
  fourthSlot.release();
});

test("search admission refuses a search whose wait expires without leaking a slot", async () => {
  const held = await acquireSearchSlot(1, 1_000);
  assert.ok(held);
  assert.equal(await acquireSearchSlot(1, 15), null);
  assert.equal(await acquireSearchSlot(1, 0), null, "a zero wait refuses immediately when full");
  held.release();
  const next = await acquireSearchSlot(1, 0);
  assert.ok(next, "the expired waiter did not keep the freed slot");
  next.release();
  await assert.rejects(acquireSearchSlot(0, 10), /positive integer/);
});

test("raising the limit admits queued searches before newcomers", async () => {
  const held = await acquireSearchSlot(1, 1_000);
  assert.ok(held);
  const queued = acquireSearchSlot(1, 1_000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newcomer = await acquireSearchSlot(3, 1_000);
  const queuedSlot = await queued;
  assert.ok(queuedSlot && newcomer);
  held.release();
  queuedSlot.release();
  newcomer.release();
});
