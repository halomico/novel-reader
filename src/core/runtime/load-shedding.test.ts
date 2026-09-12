import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePressure,
  classifyPressure,
  classifyRequest,
  pressureThresholds,
  shedReply,
  shouldShed,
  type PressureState,
} from "./load-shedding";

const thresholds = {
  busyEventLoopDelayMs: 100,
  overloadedEventLoopDelayMs: 250,
  busyPoolWaiting: 6,
  overloadedPoolWaiting: 24,
};

test("pressure rises with event-loop delay or with clients queued for the pool", () => {
  assert.equal(classifyPressure({ eventLoopDelayMs: 12, poolWaiting: 0 }, thresholds), "normal");
  assert.equal(classifyPressure({ eventLoopDelayMs: 120, poolWaiting: 0 }, thresholds), "busy");
  assert.equal(classifyPressure({ eventLoopDelayMs: 12, poolWaiting: 6 }, thresholds), "busy");
  assert.equal(classifyPressure({ eventLoopDelayMs: 300, poolWaiting: 0 }, thresholds), "overloaded");
  assert.equal(classifyPressure({ eventLoopDelayMs: 12, poolWaiting: 24 }, thresholds), "overloaded");
});

test("a raised level holds before the instance admits the full load again", () => {
  let state: PressureState = { level: "normal", holdUntil: 0 };
  state = advancePressure(state, "overloaded", 1_000, 3_000);
  assert.deepEqual(state, { level: "overloaded", holdUntil: 4_000 });
  state = advancePressure(state, "normal", 2_000, 3_000);
  assert.equal(state.level, "overloaded", "a momentary recovery does not reopen the gate");
  state = advancePressure(state, "busy", 4_500, 3_000);
  assert.deepEqual(state, { level: "busy", holdUntil: 7_500 });
  state = advancePressure(state, "overloaded", 5_000, 3_000);
  assert.deepEqual(state, { level: "overloaded", holdUntil: 8_000 }, "rising is never delayed");
  state = advancePressure(state, "normal", 8_000, 3_000);
  assert.deepEqual(state, { level: "normal", holdUntil: 0 });
});

test("beacons go first; administration and health checks are never refused", () => {
  assert.equal(classifyRequest("POST", "/api/analytics/novel-view"), "background");
  assert.equal(classifyRequest("POST", "/api/search/analytics"), "background");
  assert.equal(classifyRequest("GET", "/novels"), "standard");
  assert.equal(classifyRequest("POST", "/api/search/content"), "standard");
  for (const path of ["/admin", "/admin/books", "/api/health", "/api/ready", "/_next/data/x"]) {
    assert.equal(classifyRequest("GET", path), "exempt", path);
  }
  assert.equal(shouldShed("normal", "background"), false);
  assert.equal(shouldShed("busy", "background"), true);
  assert.equal(shouldShed("busy", "standard"), false);
  assert.equal(shouldShed("overloaded", "standard"), true);
  assert.equal(shouldShed("overloaded", "exempt"), false);
});

test("refusals explain themselves, retry on their own and let the CDN serve stale pages", () => {
  const cachedPage = shedReply({ pathname: "/novels", accept: "text/html", edgeCacheable: true, pressure: "overloaded", random: () => 0 });
  assert.equal(cachedPage.status, 503);
  assert.equal(cachedPage.retryAfterSeconds, 5);
  assert.match(cachedPage.contentType, /^text\/html/);
  assert.match(cachedPage.body, /http-equiv="refresh" content="5"/);

  const searchPage = shedReply({ pathname: "/search", accept: "text/html", edgeCacheable: false, pressure: "overloaded", random: () => 0.99 });
  assert.equal(searchPage.status, 429);
  assert.equal(searchPage.retryAfterSeconds, 9);

  const api = shedReply({ pathname: "/api/search/content", accept: "*/*", edgeCacheable: false, pressure: "overloaded", random: () => 0 });
  assert.equal(api.status, 429);
  assert.deepEqual(JSON.parse(api.body), { ok: false, message: "访问人数较多，请稍后再试" });

  const routerFetch = shedReply({ pathname: "/tags", accept: "*/*", edgeCacheable: false, pressure: "overloaded", random: () => 0 });
  assert.match(routerFetch.contentType, /^text\/plain/);

  const beacon = shedReply({ pathname: "/api/analytics/novel-view", accept: "*/*", edgeCacheable: false, pressure: "busy", random: () => 0 });
  assert.equal(beacon.retryAfterSeconds, 15);
});

test("pool thresholds follow the pool size unless tuned, and blank settings keep defaults", () => {
  const names = [
    "LOAD_SHED_BUSY_EVENT_LOOP_MS",
    "LOAD_SHED_OVERLOADED_EVENT_LOOP_MS",
    "LOAD_SHED_BUSY_POOL_WAITING",
    "LOAD_SHED_OVERLOADED_POOL_WAITING",
  ] as const;
  const saved = names.map((name) => [name, process.env[name]] as const);
  try {
    for (const name of names) delete process.env[name];
    assert.deepEqual(pressureThresholds(6), thresholds);
    process.env.LOAD_SHED_BUSY_POOL_WAITING = "";
    process.env.LOAD_SHED_OVERLOADED_EVENT_LOOP_MS = "400";
    assert.deepEqual(pressureThresholds(6), { ...thresholds, overloadedEventLoopDelayMs: 400 });
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
